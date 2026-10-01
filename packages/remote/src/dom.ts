// 用 DOM 自定义事件实现的传输层，以及把页面元素递给另一个环境的办法。
//
// 事件名里带着每个插件各自的密钥（通道名）：它只存在于扩展的存储和用户脚本的注册代码里，
// 知乎的页面脚本不知道事件名，也就听不到、伪造不了。detail 只传字符串（Firefox 里对象不能跨环境）。
// 原生函数在脚本加载时就保存下来，页面脚本之后改写 dispatchEvent 之类也不受影响。

import type { Transport } from './wire'

const PRIMS = {
  CustomEvent: globalThis.CustomEvent,
  dispatch: EventTarget.prototype.dispatchEvent,
  listen: EventTarget.prototype.addEventListener,
  unlisten: EventTarget.prototype.removeEventListener,
}

export type Side = 'host' | 'runtime'

/** host 是扩展隔离环境里的代理，runtime 是用户脚本环境里的 SDK 运行时。 */
export function domTransport(target: EventTarget, channel: string, side: Side): Transport {
  const send = `zb:${channel}:${side === 'host' ? 'h2r' : 'r2h'}`
  const receive = `zb:${channel}:${side === 'host' ? 'r2h' : 'h2r'}`
  return {
    send(frame) {
      PRIMS.dispatch.call(target, new PRIMS.CustomEvent(send, { detail: frame }))
    },
    listen(on) {
      const listener = (event: Event) => {
        const detail = (event as CustomEvent).detail
        if (typeof detail === 'string') on(detail)
      }
      PRIMS.listen.call(target, receive, listener)
      return () => PRIMS.unlisten.call(target, receive, listener)
    },
  }
}

/** 隔离环境一侧：把元素递给用户脚本环境 */
export interface ElementSharer {
  share(el: Element, token: string): void
}

/** 用户脚本环境一侧：按口令取回元素 */
export interface ElementReceiver {
  take(token: string): Element | undefined
  release(token: string): void
  close(): void
}

const elementEvent = (channel: string) => `zb:${channel}:el`

/**
 * 元素没法放进字符串里。办法是在这个元素上触发一个会冒泡、可以穿过 Shadow DOM 的事件，
 * 对方在 document 上监听，用 event.composedPath()[0] 取到事件发出的那个元素本身。
 */
export function domElementSharer(channel: string): ElementSharer {
  const name = elementEvent(channel)
  return {
    share(el, token) {
      PRIMS.dispatch.call(el, new PRIMS.CustomEvent(name, { detail: token, bubbles: true, composed: true }))
    },
  }
}

export function domElementReceiver(doc: Document, channel: string): ElementReceiver {
  const name = elementEvent(channel)
  const elements = new Map<string, Element>()
  const listener = (event: Event) => {
    const token = (event as CustomEvent).detail
    const el = event.composedPath()[0]
    if (typeof token === 'string' && el instanceof Element) elements.set(token, el)
  }
  PRIMS.listen.call(doc, name, listener, true)
  return {
    take: token => elements.get(token),
    release: token => void elements.delete(token),
    close() {
      PRIMS.unlisten.call(doc, name, listener, true)
      elements.clear()
    },
  }
}

/** 不经过 DOM 的元素传递（测试用，运行时和代理在同一个环境里） */
export function memoryElements(): { sharer: ElementSharer; receiver: ElementReceiver } {
  const elements = new Map<string, Element>()
  return {
    sharer: { share: (el, token) => void elements.set(token, el) },
    receiver: {
      take: token => elements.get(token),
      release: token => void elements.delete(token),
      close: () => elements.clear(),
    },
  }
}
