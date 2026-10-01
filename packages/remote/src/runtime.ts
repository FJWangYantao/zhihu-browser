// SDK 运行时：在用户脚本环境（USER_SCRIPT world）里运行，给插件提供 `z`。
//
// 插件调用 z 上的方法，运行时把它翻译成发给代理的消息；代理在扩展隔离环境里，对着真正的插件宿主做同样的事。
// 所以用户插件和官方插件走同一套宿主逻辑：登记、校验、熔断、清理都不用再写一遍。

import type {
  Answer,
  Comment,
  Content,
  ContentContext,
  ContentHandle,
  Dispose,
  FeedItem,
  FetchResponse,
  ItemContext,
  ItemUI,
  PageContext,
  PageInfo,
  PluginAPI,
  PluginMeta,
  SearchResult,
} from '@zhihu-browser/sdk'
import type { ElementReceiver } from './dom'
import type { ContentsEntry, FetchResult, HostCalls, RuntimeCalls } from './protocol'
import { Endpoint, type Transport } from './wire'

export interface RuntimeOptions {
  transport: Transport
  elements: ElementReceiver
  /**
   * 加载插件文件，返回它的导出（转译后的 `exports`）。每次 start 时调用一次：
   * 插件文件顶层的代码在这时才开始执行，所以没有启用的插件、安全模式下的插件什么也不会运行。
   */
  load: () => { default?: unknown }
}

export interface Runtime {
  /** 停止插件，不再响应代理。热重载时旧的运行时由新的运行时销毁。 */
  destroy(): void
}

type AnyFn = (...args: never[]) => unknown

interface Session {
  meta: PluginMeta
  settings: Record<string, unknown>
  page: PageInfo
  closed: boolean
  controller: AbortController
  settingsListeners: Set<(changed: Record<string, unknown>) => void>
  cleanup?: Dispose
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof (v as { then?: unknown } | null)?.then === 'function'

function format(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  try {
    return JSON.stringify(arg) ?? String(arg)
  } catch {
    return String(arg)
  }
}

export function startRuntime(options: RuntimeOptions): Runtime {
  const { elements } = options
  const endpoint = new Endpoint(options.transport)
  let session: Session | undefined
  let nextId = 1

  // 运行时一侧的回调，按运行时分配的 id 索引
  const filters = new Map<number, AnyFn>()
  const hooks = new Map<number, AnyFn>()
  const commands = new Map<number, AnyFn>()
  const shortcuts = new Map<number, AnyFn>()
  const actions = new Map<number, AnyFn>()
  const mounts = new Map<number, { render: AnyFn; cleanup?: Dispose }>()
  /** 钩子上下文的中止控制器，按代理分配的口令索引 */
  const contexts = new Map<string, AbortController>()

  const call = <K extends keyof RuntimeCalls>(method: K, args?: RuntimeCalls[K]): unknown =>
    endpoint.callSync(method, args)
  const asyncCall = <K extends keyof RuntimeCalls>(method: K, args?: RuntimeCalls[K]): Promise<unknown> =>
    endpoint.call(method, args)

  const log = (level: RuntimeCalls['log']['level'], message: string) => endpoint.notify('log', { level, message })

  /** 回调是异步函数时，错误没法同步交还给代理，只能记到日志里 */
  function settle(what: string, result: unknown): void {
    if (isThenable(result)) result.then(undefined, e => log('error', `${what}出错：${format(e)}`))
  }

  function disposable(id: number, cleanup?: () => void): Dispose {
    let done = false
    return () => {
      if (done) return
      done = true
      cleanup?.()
      if (session && !session.closed) endpoint.notify('dispose', { id })
    }
  }

  /** 登记一个回调：先放进表里再通知代理，通知失败（代理拒绝）时撤回 */
  function register<K extends keyof RuntimeCalls>(
    table: Map<number, unknown>,
    entry: unknown,
    method: K,
    args: (id: number) => RuntimeCalls[K],
  ): Dispose {
    const id = nextId++
    table.set(id, entry)
    try {
      call(method, args(id))
    } catch (e) {
      table.delete(id)
      throw e
    }
    return disposable(id, () => table.delete(id))
  }

  const requireFn = (fn: unknown, what: string) => {
    if (typeof fn !== 'function') throw new TypeError(`${what}必须是函数`)
  }

  // ---------- 内容和评论上的界面工具 ----------

  function itemUI(tid: string): ItemUI {
    return {
      badge: (text, opts) => {
        const id = nextId++
        call('item.badge', { id, tid, text: String(text), ...(opts ? { options: opts } : {}) })
        return disposable(id)
      },
      fold: reason => {
        const id = nextId++
        call('item.fold', { id, tid, reason: String(reason) })
        return disposable(id)
      },
      addAction: action => {
        requireFn(action?.onClick, 'addAction 的 onClick ')
        const dispose = register(actions, action.onClick, 'item.action', id => ({
          id,
          tid,
          label: String(action.label),
          ...(action.title === undefined ? {} : { title: String(action.title) }),
        }))
        return dispose
      },
      mount: (position, render) => {
        requireFn(render, 'mount 的渲染函数')
        const entry = { render: render as AnyFn }
        const id = nextId++
        mounts.set(id, entry)
        try {
          call('item.mount', { id, tid, position })
        } catch (e) {
          mounts.delete(id)
          throw e
        }
        return disposable(id, () => dropMount(id))
      },
    }
  }

  function dropMount(id: number): void {
    const m = mounts.get(id)
    mounts.delete(id)
    if (!m?.cleanup) return
    try {
      m.cleanup()
    } catch (e) {
      log('error', `清理界面出错：${format(e)}`)
    }
  }

  /** 为一次钩子调用建立中止信号：代理通知 abort（元素被移除、离开页面）或插件停止时中止 */
  function contextSignal(tid: string): AbortSignal {
    const controller = new AbortController()
    contexts.set(tid, controller)
    return controller.signal
  }

  function itemContext(tid: string, page: PageInfo): ItemContext {
    return {
      page,
      signal: contextSignal(tid),
      ui: itemUI(tid),
      get el(): HTMLElement {
        const el = elements.take(tid)
        if (!el) throw new Error('拿不到这块内容对应的页面元素')
        return el as HTMLElement
      },
    }
  }

  function contentHandle(entry: ContentsEntry): ContentHandle {
    const { hid } = entry
    return {
      data: entry.data,
      expand: () => void call('handle.call', { hid, method: 'expand' }),
      collapse: () => void call('handle.call', { hid, method: 'collapse' }),
      scrollIntoView: () => void call('handle.call', { hid, method: 'scrollIntoView' }),
      isVisible: () => call('handle.visible', { hid }) === true,
    }
  }

  // ---------- z ----------

  function createApi(s: Session): PluginAPI {
    const hook = (event: 'page' | 'content' | 'comment', fn: unknown): Dispose => {
      requireFn(fn, 'on() 的第二个参数')
      return register(hooks, fn, 'on', id => ({ id, event }))
    }
    const api: PluginAPI = {
      meta: s.meta,
      page: () => s.page,
      on: hook as PluginAPI['on'],
      filter: ((kind, fn) => {
        requireFn(fn, 'filter() 的第二个参数')
        return register(filters, fn, 'filter', id => ({ id, kind }))
      }) as PluginAPI['filter'],
      contents: {
        all: () => (call('contents.all') as ContentsEntry[]).map(contentHandle),
        current() {
          const entry = call('contents.current') as ContentsEntry | null
          return entry ? contentHandle(entry) : undefined
        },
      },
      registerCommand(cmdId, command) {
        requireFn(command?.run, '命令的 run ')
        return register(commands, command.run, 'command', id => ({
          id,
          cmdId,
          title: String(command.title),
          ...(command.keywords ? { keywords: [...command.keywords] } : {}),
          ...(command.when ? { when: [...command.when] } : {}),
        }))
      },
      registerShortcut(keys, run, shortcutOptions) {
        requireFn(run, 'registerShortcut() 的第二个参数')
        return register(shortcuts, run, 'shortcut', id => ({
          id,
          keys: String(keys),
          options: { ...shortcutOptions },
        }))
      },
      settings: {
        get: key => s.settings[key as string] as never,
        set: async (key, value) => {
          await asyncCall('settings.set', { key: String(key), value })
        },
        onChange(handler) {
          requireFn(handler, 'onChange() 的参数')
          const fn = handler as (changed: Record<string, unknown>) => void
          s.settingsListeners.add(fn)
          return () => s.settingsListeners.delete(fn)
        },
      },
      ui: {
        toast: (message, opts) => call('ui.toast', { message: String(message), ...(opts ? { options: opts } : {}) }),
        confirm: (message, opts) =>
          asyncCall('ui.confirm', { message: String(message), ...(opts ? { options: opts } : {}) }) as Promise<boolean>,
        mount(slot, render) {
          requireFn(render, 'mount 的渲染函数')
          const entry = { render: render as AnyFn }
          const id = nextId++
          mounts.set(id, entry)
          try {
            call('mount', { id, slot })
          } catch (e) {
            mounts.delete(id)
            throw e
          }
          return disposable(id, () => dropMount(id))
        },
      },
      addStyle(css) {
        const id = nextId++
        call('addStyle', { id, css: String(css) })
        return disposable(id)
      },
      storage: {
        get: key => asyncCall('storage.get', { key }) as never,
        set: async (key, value) => {
          await asyncCall('storage.set', { key, value })
        },
        delete: async key => {
          await asyncCall('storage.delete', { key })
        },
        keys: () => asyncCall('storage.keys') as Promise<string[]>,
      },
      async fetch(url, init) {
        const r = (await asyncCall('fetch', { url: String(url), ...(init ? { init } : {}) })) as FetchResult
        const response: FetchResponse = {
          status: r.status,
          ok: r.ok,
          headers: r.headers,
          text: () => Promise.resolve(r.text),
          json: <T>() => Promise.resolve().then(() => JSON.parse(r.text) as T),
        }
        return response
      },
      log: {
        debug: (...args) => log('debug', args.map(format).join(' ')),
        info: (...args) => log('info', args.map(format).join(' ')),
        warn: (...args) => log('warn', args.map(format).join(' ')),
        error: (...args) => log('error', args.map(format).join(' ')),
      },
    }
    return api
  }

  // ---------- 停止 ----------

  function stopSession(): void {
    const s = session
    if (!s) return
    session = undefined
    s.closed = true
    s.controller.abort()
    for (const controller of contexts.values()) controller.abort()
    for (const tid of contexts.keys()) elements.release(tid)
    contexts.clear()
    for (const id of [...mounts.keys()]) dropMount(id)
    for (const table of [filters, hooks, commands, shortcuts, actions]) table.clear()
    s.settingsListeners.clear()
    if (s.cleanup) {
      try {
        s.cleanup()
      } catch (e) {
        endpoint.notify('log', { level: 'error', message: `清理函数出错：${format(e)}` })
      }
    }
  }

  // ---------- 代理发来的调用 ----------

  endpoint.handle<HostCalls['probe']>('probe', () => endpoint.notify('hello'))

  endpoint.handle<HostCalls['start']>('start', async ({ meta, settings, page }) => {
    stopSession()
    const s: Session = {
      meta,
      settings,
      page,
      closed: false,
      controller: new AbortController(),
      settingsListeners: new Set(),
    }
    session = s
    const entry = options.load().default
    if (typeof entry !== 'function') throw new Error('插件文件必须默认导出一个函数')
    const result: unknown = await (entry as (z: PluginAPI) => unknown)(createApi(s))
    if (typeof result !== 'function') return
    if (s.closed) (result as Dispose)()
    else s.cleanup = result as Dispose
  })

  endpoint.handle<HostCalls['stop']>('stop', () => stopSession())

  endpoint.handle<HostCalls['call.filter']>('call.filter', ({ id, item }) => {
    const fn = filters.get(id)
    if (!fn) return true
    return (fn as (item: FeedItem | Answer | Comment | SearchResult) => unknown)(item) as boolean
  })

  endpoint.handle<HostCalls['call.page']>('call.page', ({ id, tid, page }) => {
    const fn = hooks.get(id)
    if (!fn) return
    const pageCtx: PageContext = { page, signal: contextSignal(tid) }
    settle('页面钩子', (fn as (page: PageInfo, ctx: PageContext) => unknown)(page, pageCtx))
  })

  endpoint.handle<HostCalls['call.content']>('call.content', ({ id, tid, hid, page, data }) => {
    const fn = hooks.get(id)
    if (!fn) return
    // el 是按需读取的属性，不能用展开语法复制
    const ctx = Object.defineProperty(itemContext(tid, page), 'handle', {
      value: contentHandle({ hid, data }),
      enumerable: true,
    }) as ContentContext
    settle('渲染钩子', (fn as (content: Content, ctx: ContentContext) => unknown)(data, ctx))
  })

  endpoint.handle<HostCalls['call.comment']>('call.comment', ({ id, tid, page, data }) => {
    const fn = hooks.get(id)
    if (!fn) return
    settle('评论钩子', (fn as (comment: Comment, ctx: ItemContext) => unknown)(data, itemContext(tid, page)))
  })

  endpoint.handle<HostCalls['abort']>('abort', ({ tid }) => {
    contexts.get(tid)?.abort()
    contexts.delete(tid)
    elements.release(tid)
  })

  const runner = (table: Map<number, AnyFn>, what: string) => (args: { id: number }) => {
    const fn = table.get(args.id)
    if (fn) settle(what, (fn as () => unknown)())
  }
  endpoint.handle<HostCalls['call.command']>('call.command', runner(commands, '命令'))
  endpoint.handle<HostCalls['call.shortcut']>('call.shortcut', runner(shortcuts, '快捷键'))
  endpoint.handle<HostCalls['call.action']>('call.action', runner(actions, '按钮'))

  endpoint.handle<HostCalls['mount.render']>('mount.render', ({ id, token }) => {
    const m = mounts.get(id)
    if (!m) return
    const container = elements.take(token)
    elements.release(token)
    if (!container) throw new Error('拿不到挂载点的容器')
    const result = (m.render as (container: HTMLElement) => unknown)(container as HTMLElement)
    if (typeof result === 'function') m.cleanup = result as Dispose
    else settle('界面', result)
  })

  endpoint.handle<HostCalls['mount.dispose']>('mount.dispose', ({ id }) => {
    const m = mounts.get(id)
    if (!m?.cleanup) return
    const cleanup = m.cleanup
    delete m.cleanup
    cleanup()
  })

  endpoint.handle<HostCalls['page.set']>('page.set', ({ page }) => {
    if (session) session.page = page
  })

  endpoint.handle<HostCalls['settings.update']>('settings.update', ({ values, changed }) => {
    const s = session
    if (!s) return
    s.settings = values
    const partial: Record<string, unknown> = {}
    for (const key of changed) partial[key] = values[key]
    for (const fn of [...s.settingsListeners]) {
      try {
        fn(partial)
      } catch (e) {
        log('error', `设置回调出错：${format(e)}`)
      }
    }
  })

  endpoint.notify('hello')

  return {
    destroy() {
      stopSession()
      endpoint.close()
      elements.close()
    },
  }
}
