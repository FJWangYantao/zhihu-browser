// 页面主环境（MAIN world）与扩展隔离环境（ISOLATED world）之间的同步通信。
//
// 两边通过 document 上的 DOM 自定义事件互相发消息。dispatchEvent 是同步的：对方的监听函数执行完才返回，
// 所以页面主环境发出请求后，立刻就能拿到隔离环境的回复（M0 实测中位数约 0 毫秒）。
// 为兼容 Firefox，只传字符串：第一行是 JSON 消息头，其余是正文（接口响应原文，免得再转义一次）。

import type { Dispose } from '@zhihu-browser/sdk'

/** 页面主环境 → 扩展隔离环境 */
export const TO_ISOLATED = 'zb:m2i'
/** 扩展隔离环境 → 页面主环境 */
export const TO_MAIN = 'zb:i2m'
/** 由扩展隔离环境在内容元素上触发，请页面主环境读出元素的 React 属性里的内容 id */
export const ASK_REACT = 'zb:ask'

export interface ReactRef {
  type: string
  id: string
}

/** 发给扩展隔离环境的消息 */
export type ToIsolated =
  /** 页面主环境的脚本已就绪 */
  | { type: 'hello' }
  /** 单页应用换了页面 */
  | { type: 'route'; url: string }
  /** 知乎前端已完成服务端渲染内容的激活（hydration），可以往这些元素里插入界面了 */
  | { type: 'hydrated' }
  /** 拦截到的接口响应，正文是响应原文；需要同步回复 */
  | { type: 'response'; id: number; url: string }
  /** 对 ASK_REACT 的回复：由近到远排列的候选内容 */
  | { type: 'react'; refs: ReactRef[] }

/** 发给页面主环境的消息 */
export type ToMain =
  /** 插件已加载，可以开始处理接口响应 */
  | { type: 'ready' }
  /** 对 response 的回复：changed 为 true 时正文是改写后的响应 */
  | { type: 'reply'; id: number; changed: boolean }

export interface Message<T> {
  head: T
  body: string
}

/** 在脚本加载时保存一份原生函数：页面脚本之后改写它们也不影响通信 */
const PRIMS = {
  CustomEvent: globalThis.CustomEvent,
  dispatch: EventTarget.prototype.dispatchEvent,
  listen: EventTarget.prototype.addEventListener,
  unlisten: EventTarget.prototype.removeEventListener,
  stringify: JSON.stringify,
  parse: JSON.parse,
}

export function encode(head: object, body = ''): string {
  return `${PRIMS.stringify(head)}\n${body}`
}

export function decode<T extends { type: string }>(detail: unknown): Message<T> | undefined {
  if (typeof detail !== 'string') return undefined
  const i = detail.indexOf('\n')
  let head: unknown
  try {
    head = PRIMS.parse(i < 0 ? detail : detail.slice(0, i))
  } catch {
    return undefined
  }
  if (typeof head !== 'object' || head === null || typeof (head as { type?: unknown }).type !== 'string') {
    return undefined
  }
  return { head: head as T, body: i < 0 ? '' : detail.slice(i + 1) }
}

export interface Channel<Out> {
  send(head: Out, body?: string): void
  close: Dispose
}

/**
 * 打开一端的通道：监听 receive 事件，向对方发送 send 事件。
 * 页面主环境用 open(document, TO_MAIN, TO_ISOLATED, …)，扩展隔离环境反过来。
 */
export function open<In extends { type: string }, Out extends { type: string }>(
  target: EventTarget,
  receive: string,
  send: string,
  onMessage: (message: Message<In>, event: Event) => void,
): Channel<Out> {
  const listener = (event: Event) => {
    const message = decode<In>((event as CustomEvent).detail)
    if (message) onMessage(message, event)
  }
  PRIMS.listen.call(target, receive, listener)
  return {
    send(head, body) {
      PRIMS.dispatch.call(target, new PRIMS.CustomEvent(send, { detail: encode(head, body) }))
    },
    close: () => PRIMS.unlisten.call(target, receive, listener),
  }
}
