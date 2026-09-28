// 页面主环境（MAIN world）部分。和知乎页面脚本共享 JS 环境，所以只放最少的代码，不运行任何插件：
//
// 1. 拦截知乎前端自己请求到的数据接口响应（请求本身不改，签名由知乎自己完成），同步交给扩展隔离环境处理，
//    按回复改写响应，这样过滤发生在知乎渲染之前；
// 2. 发现单页应用的页面切换；
// 3. 替扩展隔离环境读取元素上的 React 属性（隔离环境读不到）；
// 4. 告诉扩展隔离环境，知乎前端什么时候完成了服务端渲染内容的激活（hydration）。
//
// 必须在 document_start 最早执行：M0 发现有别的代码会在我们之后再包一层 fetch。

import type { Dispose } from '@zhihu-browser/sdk'
import { DATA_API } from './api-urls'
import { ASK_REACT, open, type ReactRef, TO_ISOLATED, TO_MAIN, type ToIsolated, type ToMain } from './bridge'

export interface MainWorldOptions {
  /** 最多等扩展隔离环境多久（毫秒）；超时后接口响应原样放行。默认 3000 */
  readyTimeout?: number
  /** 最多等知乎前端激活多久（毫秒）；超时后当作已激活。默认 10000 */
  hydrationTimeout?: number
}

const INSTALLED = Symbol.for('zhihu-browser.main-world')
const FIBER_PREFIXES = ['__reactFiber$', '__reactInternalInstance$']
const CONTENT_TYPES = new Set(['answer', 'article', 'question', 'pin', 'zvideo'])
/** 可能带着内容数据的 React 属性名，按优先级排列（M0 在内容元素上见到的） */
const REACT_PROPS = ['answer', 'article', 'pin', 'zvideo', 'content', 'data', 'item']
/** 判断知乎前端是否已经激活时检查的元素 */
const HYDRATION_PROBE = '[data-zop], .ContentItem, .QuestionHeader, .HotItem, #root > *'
/** 看到 React 的内部属性之后，再等多久才认为激活完成（毫秒） */
const HYDRATION_GRACE_MS = 300

const parse = JSON.parse
const stringify = JSON.stringify

type XhrState = { url: string; done?: boolean; text?: string; json?: unknown }

/** 安装页面主环境部分，返回卸载函数（用于测试）。重复安装不会生效。 */
export function installMainWorld(options: MainWorldOptions = {}): Dispose {
  const win = window as Window & { [INSTALLED]?: boolean }
  if (win[INSTALLED]) return () => {}
  win[INSTALLED] = true
  const undo: (() => void)[] = [() => delete win[INSTALLED]]

  // ---------- 与扩展隔离环境的通道 ----------

  let ready = false
  let hydrated = false
  let seq = 0
  const replies = new Map<number, string | null>()
  let markReady = () => {}
  const readyPromise = new Promise<void>(resolve => {
    markReady = resolve
  })
  const readyTimer = setTimeout(() => markReady(), options.readyTimeout ?? 3000)
  undo.push(() => clearTimeout(readyTimer))

  const channel = open<ToMain, ToIsolated>(document, TO_MAIN, TO_ISOLATED, ({ head, body }) => {
    if (head.type === 'ready') {
      ready = true
      markReady()
      // 隔离环境重新启动过，或者比我们晚就绪：补发激活状态
      if (hydrated) channel.send({ type: 'hydrated' })
    } else if (head.type === 'reply') {
      replies.set(head.id, head.changed ? body : null)
    }
  })
  undo.push(channel.close)

  /** 把响应原文交给隔离环境，同步拿到改写后的响应；不需要改写时返回 undefined */
  function exchange(url: string, text: string): string | undefined {
    const id = ++seq
    channel.send({ type: 'response', id, url }, text)
    const reply = replies.get(id)
    replies.delete(id)
    return reply ?? undefined
  }

  const absolute = (url: unknown) => {
    try {
      return new URL(String(url), location.href).href
    } catch {
      return undefined
    }
  }

  // ---------- fetch ----------

  const origFetch = win.fetch
  if (typeof origFetch === 'function') {
    const rewrite = async (res: Response, url: string): Promise<Response> => {
      try {
        if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return res
        await readyPromise
        if (!ready) return res
        const text = await res.clone().text()
        const out = exchange(res.url || url, text)
        if (out === undefined) return res
        const headers = new Headers(res.headers)
        headers.delete('content-length')
        headers.delete('content-encoding')
        const next = new Response(out, { status: res.status, statusText: res.statusText, headers })
        for (const key of ['url', 'redirected', 'type'] as const) {
          Object.defineProperty(next, key, { value: res[key], configurable: true })
        }
        return next
      } catch {
        return res
      }
    }
    const patched = function fetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      // 不能用 this 调用：知乎可能以 window.fetch(...) 之外的方式调用它
      const promise = origFetch.call(win, input, init)
      const url = absolute(input instanceof Request ? input.url : input instanceof URL ? input.href : input)
      if (!url || !DATA_API.test(url)) return promise
      return promise.then(res => rewrite(res, url))
    }
    win.fetch = patched as typeof fetch
    undo.push(() => {
      if (win.fetch === patched) win.fetch = origFetch
    })
  }

  // ---------- XMLHttpRequest ----------
  // 改写 responseText / response 的读取：知乎读取时才同步处理，与它注册回调的先后顺序无关。

  const proto = (win as unknown as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest?.prototype
  const textDesc = proto && Object.getOwnPropertyDescriptor(proto, 'responseText')
  const responseDesc = proto && Object.getOwnPropertyDescriptor(proto, 'response')
  const origOpen = proto?.open
  if (proto && origOpen && textDesc?.get && responseDesc?.get) {
    const getText = textDesc.get
    const getResponse = responseDesc.get
    const states = new WeakMap<XMLHttpRequest, XhrState>()

    proto.open = function open(this: XMLHttpRequest, ...args: unknown[]) {
      states.delete(this)
      const url = absolute(args[1])
      if (url && DATA_API.test(url)) states.set(this, { url })
      return (origOpen as (...a: unknown[]) => void).apply(this, args)
    } as typeof proto.open

    const rewritten = (xhr: XMLHttpRequest): XhrState | undefined => {
      const state = states.get(xhr)
      if (!state || xhr.readyState !== 4) return undefined
      if (!state.done) {
        state.done = true
        try {
          const type = xhr.responseType
          const ok = xhr.status >= 200 && xhr.status < 300
          if (ready && ok && /json/i.test(xhr.getResponseHeader('content-type') ?? '')) {
            let text: string | undefined
            if (type === '' || type === 'text') text = getText.call(xhr)
            else if (type === 'json') {
              const value = getResponse.call(xhr)
              text = value == null ? undefined : stringify(value)
            }
            const out = text ? exchange(xhr.responseURL || state.url, text) : undefined
            if (out !== undefined) {
              state.text = out
              if (type === 'json') state.json = parse(out)
            }
          }
        } catch {
          // 出错时原样放行
        }
      }
      return state.text === undefined ? undefined : state
    }

    Object.defineProperty(proto, 'responseText', {
      ...textDesc,
      get(this: XMLHttpRequest) {
        const state = rewritten(this)
        return state && (this.responseType === '' || this.responseType === 'text') ? state.text : getText.call(this)
      },
    })
    Object.defineProperty(proto, 'response', {
      ...responseDesc,
      get(this: XMLHttpRequest) {
        const state = rewritten(this)
        if (!state) return getResponse.call(this)
        return this.responseType === 'json' ? state.json : state.text
      },
    })
    undo.push(() => {
      proto.open = origOpen
      Object.defineProperty(proto, 'responseText', textDesc)
      Object.defineProperty(proto, 'response', responseDesc)
    })
  }

  // ---------- 单页应用路由 ----------

  const strip = (url: string) => url.split('#')[0] ?? url
  let lastUrl = strip(location.href)
  const notifyRoute = () => {
    const url = location.href
    if (strip(url) === lastUrl) return
    lastUrl = strip(url)
    channel.send({ type: 'route', url })
  }
  for (const name of ['pushState', 'replaceState'] as const) {
    const orig = history[name]
    const patched = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = orig.apply(this, args)
      notifyRoute()
      return result
    }
    history[name] = patched
    undo.push(() => {
      if (history[name] === patched) history[name] = orig
    })
  }
  win.addEventListener('popstate', notifyRoute)
  undo.push(() => win.removeEventListener('popstate', notifyRoute))
  const navigation = (win as { navigation?: EventTarget }).navigation
  if (navigation) {
    navigation.addEventListener('currententrychange', notifyRoute)
    undo.push(() => navigation.removeEventListener('currententrychange', notifyRoute))
  }

  // ---------- React 属性 ----------

  const onAsk = (event: Event) => {
    const el = event.target
    if (el instanceof Element) channel.send({ type: 'react', refs: reactRefs(el) })
  }
  document.addEventListener(ASK_REACT, onAsk, true)
  undo.push(() => document.removeEventListener(ASK_REACT, onAsk, true))

  // ---------- 激活（hydration） ----------

  // 看到 React 的内部属性后再等一小会儿：React 可能分几批激活页面，过早插入节点会和服务端渲染的结果对不上
  const hydrationTimeout = options.hydrationTimeout ?? 10_000
  const started = Date.now()
  let fiberSeenAt: number | undefined
  const markHydrated = () => {
    if (hydrated) return
    hydrated = true
    clearInterval(hydrationTimer)
    channel.send({ type: 'hydrated' })
  }
  const hydrationTimer = setInterval(() => {
    const now = Date.now()
    if (now - started > hydrationTimeout) return markHydrated()
    if (document.readyState === 'loading') return
    if (fiberSeenAt === undefined && hasFiber(document.querySelector(HYDRATION_PROBE))) fiberSeenAt = now
    if (fiberSeenAt !== undefined && now - fiberSeenAt >= HYDRATION_GRACE_MS) markHydrated()
  }, 100)
  undo.push(() => clearInterval(hydrationTimer))

  channel.send({ type: 'hello' })

  return () => {
    for (const fn of undo.reverse()) fn()
  }
}

function fiberKey(el: Element): string | undefined {
  return Object.keys(el).find(key => FIBER_PREFIXES.some(prefix => key.startsWith(prefix)))
}

function hasFiber(el: Element | null): boolean {
  return !!el && fiberKey(el) !== undefined
}

function refOf(value: unknown): ReactRef | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { type, id } = value as { type?: unknown; id?: unknown }
  if (typeof type !== 'string' || !CONTENT_TYPES.has(type)) return undefined
  if (typeof id === 'string' && id) return { type, id }
  if (typeof id === 'number' && Number.isFinite(id)) return { type, id: String(id) }
  return undefined
}

/** 从元素往上找 React 组件的属性里带着的内容，由近到远排列 */
export function reactRefs(el: Element, maxDepth = 12): ReactRef[] {
  const key = fiberKey(el)
  if (!key) return []
  const refs: ReactRef[] = []
  const seen = new Set<string>()
  try {
    let fiber = (el as unknown as Record<string, unknown>)[key] as
      | { return?: unknown; memoizedProps?: unknown }
      | undefined
    for (let depth = 0; fiber && depth < maxDepth && refs.length < 8; depth++) {
      const props = fiber.memoizedProps
      if (typeof props === 'object' && props !== null) {
        for (const name of REACT_PROPS) {
          const value = (props as Record<string, unknown>)[name]
          const nested = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
          for (const candidate of [value, nested.target, nested.object]) {
            const ref = refOf(candidate)
            if (ref && !seen.has(`${ref.type}:${ref.id}`)) {
              seen.add(`${ref.type}:${ref.id}`)
              refs.push(ref)
            }
          }
        }
      }
      fiber = fiber.return as typeof fiber
    }
  } catch {
    // React 内部结构变了：当作没找到
  }
  return refs
}
