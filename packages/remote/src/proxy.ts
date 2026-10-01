// 代理：在扩展隔离环境里，把用户脚本环境里的插件接到宿主上。
//
// 代理是一个普通的插件模块：宿主调用它的默认函数时，它等运行时就绪，让运行时开始执行用户的插件代码；
// 运行时发来的每一次登记（过滤函数、钩子、命令……），代理就对着宿主给它的 `z` 做同一件事，
// 并在回调触发时转发给运行时。熔断、计时、清理都由宿主按"一个普通插件"处理。

import type {
  Comment,
  Content,
  ContentHandle,
  Dispose,
  ItemContext,
  PageContext,
  PageInfo,
  PluginAPI,
  PluginMeta,
  PluginModule,
} from '@zhihu-browser/sdk'
import type { ElementSharer } from './dom'
import type { ContentsEntry, FetchResult, HostCalls, RuntimeCalls } from './protocol'
import { Endpoint, type Transport } from './wire'

export interface RemotePluginOptions {
  meta: PluginMeta
  transport: Transport
  /** 把页面元素递给用户脚本环境 */
  elements: ElementSharer
  /** 等运行时就绪的最长时间（毫秒），默认 5000 */
  startTimeoutMs?: number
}

/** 运行时没有出现（没有开启"允许用户脚本"、脚本没有注册等）。 */
export const NO_RUNTIME_MESSAGE = '用户脚本环境没有响应：请确认已开启"允许用户脚本"，并刷新页面'

/** 把 meta 和传输层包装成宿主可以加载的插件模块。 */
export function remotePlugin(options: RemotePluginOptions): PluginModule {
  const { meta, transport, elements } = options
  return {
    meta,
    default: async (z: PluginAPI) => {
      const endpoint = new Endpoint(transport)
      let closed = false
      let tokenCounter = 0
      /** 运行时分配的 id → 撤销函数 */
      const disposers = new Map<number, Dispose>()
      /** 钩子上下文口令 → 上下文（运行时的界面调用据此找到对应的元素） */
      const items = new Map<string, ItemContext>()
      const handles = new Map<string, WeakRef<ContentHandle>>()
      const handleIds = new WeakMap<ContentHandle, string>()

      const token = (prefix: string) => `${prefix}${++tokenCounter}`
      const call = <K extends keyof HostCalls>(method: K, args?: HostCalls[K]) => endpoint.callSync(method, args)

      const hello = new Promise<void>(resolve => endpoint.handle('hello', () => resolve()))
      endpoint.notify('probe')
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(NO_RUNTIME_MESSAGE)), options.startTimeoutMs ?? 5000)
      })
      try {
        await Promise.race([hello, timeout])
      } catch (e) {
        closed = true
        endpoint.close()
        throw e
      } finally {
        clearTimeout(timer)
      }

      const handleId = (handle: ContentHandle): string => {
        let hid = handleIds.get(handle)
        if (!hid) {
          hid = token('h')
          handleIds.set(handle, hid)
          handles.set(hid, new WeakRef(handle))
        }
        return hid
      }
      const handleOf = (hid: string): ContentHandle => {
        const handle = handles.get(hid)?.deref()
        if (!handle) throw new Error('这块内容已经不在页面上')
        return handle
      }
      const entryOf = (handle: ContentHandle): ContentsEntry => ({ hid: handleId(handle), data: handle.data })

      const own = <T extends { id: number }>(args: T, dispose: Dispose): void => {
        disposers.set(args.id, dispose)
      }
      const itemOf = (tid: string): ItemContext => {
        const ctx = items.get(tid)
        if (!ctx) throw new Error('这块内容已经不在页面上')
        return ctx
      }

      /** 登记一次钩子调用的上下文：元素递给运行时，上下文失效时通知它 */
      function enter(ctx: { signal: AbortSignal; el?: HTMLElement }, prefix: string): string {
        const tid = token(prefix)
        if (ctx.el) elements.share(ctx.el, tid)
        items.set(tid, ctx as ItemContext)
        ctx.signal.addEventListener(
          'abort',
          () => {
            items.delete(tid)
            if (!closed) endpoint.notify('abort', { tid })
          },
          { once: true },
        )
        return tid
      }

      // ---------- 运行时 → 宿主 ----------

      endpoint.handle<RuntimeCalls['filter']>('filter', args => {
        own(
          args,
          z.filter(args.kind as 'feed', item => {
            // 出错、没有回复时抛出，由宿主按"出错，保留"处理并计入熔断
            return endpoint.callSync<boolean | undefined>('call.filter', { id: args.id, item }) !== false
          }),
        )
      })

      endpoint.handle<RuntimeCalls['on']>('on', args => {
        const { id, event } = args
        if (event === 'page') {
          own(
            args,
            z.on('page', (page: PageInfo, ctx: PageContext) => {
              call('call.page', { id, tid: enter(ctx, 'p'), page })
            }),
          )
        } else if (event === 'content') {
          own(
            args,
            z.on('content', (data: Content, ctx) => {
              call('call.content', { id, tid: enter(ctx, 'c'), hid: handleId(ctx.handle), page: ctx.page, data })
            }),
          )
        } else if (event === 'comment') {
          own(
            args,
            z.on('comment', (data: Comment, ctx) => {
              call('call.comment', { id, tid: enter(ctx, 'm'), page: ctx.page, data })
            }),
          )
        } else throw new Error(`不支持的事件 ${String(event)}（支持 page、content、comment）`)
      })

      endpoint.handle<RuntimeCalls['command']>('command', args => {
        own(
          args,
          z.registerCommand(args.cmdId, {
            title: args.title,
            ...(args.keywords ? { keywords: args.keywords } : {}),
            ...(args.when ? { when: args.when } : {}),
            run: () => void call('call.command', { id: args.id }),
          }),
        )
      })

      endpoint.handle<RuntimeCalls['shortcut']>('shortcut', args => {
        own(
          args,
          z.registerShortcut(args.keys, () => call('call.shortcut', { id: args.id }), args.options),
        )
      })

      endpoint.handle<RuntimeCalls['addStyle']>('addStyle', args => own(args, z.addStyle(args.css)))

      /** 把容器递给运行时渲染；渲染函数的清理在容器撤销时执行 */
      const render = (id: number) => (container: HTMLElement) => {
        const mountToken = token('u')
        elements.share(container, mountToken)
        call('mount.render', { id, token: mountToken })
        return () => {
          if (!closed) call('mount.dispose', { id })
        }
      }

      endpoint.handle<RuntimeCalls['mount']>('mount', args => {
        own(args, z.ui.mount(args.slot, render(args.id)))
      })

      endpoint.handle<RuntimeCalls['item.badge']>('item.badge', args => {
        own(args, itemOf(args.tid).ui.badge(args.text, args.options))
      })
      endpoint.handle<RuntimeCalls['item.fold']>('item.fold', args => {
        own(args, itemOf(args.tid).ui.fold(args.reason))
      })
      endpoint.handle<RuntimeCalls['item.action']>('item.action', args => {
        own(
          args,
          itemOf(args.tid).ui.addAction({
            label: args.label,
            ...(args.title === undefined ? {} : { title: args.title }),
            onClick: () => call('call.action', { id: args.id }),
          }),
        )
      })
      endpoint.handle<RuntimeCalls['item.mount']>('item.mount', args => {
        own(args, itemOf(args.tid).ui.mount(args.position, render(args.id)))
      })

      endpoint.handle<RuntimeCalls['dispose']>('dispose', ({ id }) => {
        const dispose = disposers.get(id)
        disposers.delete(id)
        dispose?.()
      })

      endpoint.handle<RuntimeCalls['handle.call']>('handle.call', ({ hid, method }) => {
        const handle = handleOf(hid)
        if (method !== 'expand' && method !== 'collapse' && method !== 'scrollIntoView') {
          throw new Error(`不支持的操作 ${String(method)}`)
        }
        handle[method]()
      })
      endpoint.handle<RuntimeCalls['handle.visible']>('handle.visible', ({ hid }) => handleOf(hid).isVisible())
      endpoint.handle('contents.all', () => z.contents.all().map(entryOf))
      endpoint.handle('contents.current', () => {
        const handle = z.contents.current()
        return handle ? entryOf(handle) : null
      })

      endpoint.handle<RuntimeCalls['ui.toast']>('ui.toast', ({ message, options: o }) => z.ui.toast(message, o))
      endpoint.handle<RuntimeCalls['ui.confirm']>('ui.confirm', ({ message, options: o }) => z.ui.confirm(message, o))

      endpoint.handle<RuntimeCalls['settings.set']>('settings.set', ({ key, value }) =>
        (z.settings.set as (key: string, value: unknown) => Promise<void>)(key, value),
      )
      endpoint.handle<RuntimeCalls['storage.get']>('storage.get', ({ key }) => z.storage.get(key))
      endpoint.handle<RuntimeCalls['storage.set']>('storage.set', ({ key, value }) => z.storage.set(key, value))
      endpoint.handle<RuntimeCalls['storage.delete']>('storage.delete', ({ key }) => z.storage.delete(key))
      endpoint.handle('storage.keys', () => z.storage.keys())

      endpoint.handle<RuntimeCalls['fetch']>('fetch', async ({ url, init }): Promise<FetchResult> => {
        const response = await z.fetch(url, init)
        return { status: response.status, ok: response.ok, headers: response.headers, text: await response.text() }
      })

      endpoint.handle<RuntimeCalls['log']>('log', ({ level, message }) => {
        if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') z.log[level](message)
      })

      // ---------- 宿主 → 运行时 ----------

      const settingKeys = Object.keys(meta.settings ?? {})
      const snapshot = (): Record<string, unknown> =>
        Object.fromEntries(settingKeys.map(k => [k, (z.settings.get as (k: string) => unknown)(k)]))
      const stopSettings = z.settings.onChange(changed => {
        if (!closed) endpoint.notify('settings.update', { values: snapshot(), changed: Object.keys(changed) })
      })
      const stopPage = z.on('page', page => {
        if (!closed) endpoint.notify('page.set', { page })
      })

      try {
        await endpoint.call('start', { meta, settings: snapshot(), page: z.page() })
      } catch (e) {
        closed = true
        stopSettings()
        stopPage()
        endpoint.close()
        throw e
      }

      return () => {
        if (closed) return
        closed = true
        stopSettings()
        stopPage()
        // 运行时一侧会自己撤销全部登记；宿主一侧的由宿主统一清理，这里不再逐个撤销
        endpoint.notify('stop')
        endpoint.close()
        disposers.clear()
        items.clear()
        handles.clear()
      }
    },
  }
}
