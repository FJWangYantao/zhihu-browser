import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ASK_REACT, type Message, open, TO_ISOLATED, TO_MAIN, type ToIsolated, type ToMain } from '../src/bridge'
import { installMainWorld, reactRefs } from '../src/main-world'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const API = 'https://www.zhihu.com/api/v3/feed/topstory/recommend?desktop=true'

/** 模拟扩展隔离环境：记录收到的消息，按 respond 回复接口响应 */
function isolated(respond: (url: string, body: string) => string | undefined = () => undefined) {
  const messages: Message<ToIsolated>[] = []
  const channel = open<ToIsolated, ToMain>(document, TO_ISOLATED, TO_MAIN, message => {
    messages.push(message)
    const { head, body } = message
    if (head.type === 'response') {
      const out = respond(head.url, body)
      channel.send({ type: 'reply', id: head.id, changed: out !== undefined }, out)
    }
  })
  return {
    messages,
    types: () => messages.map(m => m.head.type),
    ready: () => channel.send({ type: 'ready' }),
    close: channel.close,
  }
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init })

describe('fetch', () => {
  let uninstall: () => void
  let side: ReturnType<typeof isolated>
  const origFetch = window.fetch
  const calls: string[] = []

  beforeEach(() => {
    calls.length = 0
    window.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      calls.push(url)
      return json({ data: [1, 2, 3], url })
    }) as typeof fetch
    side = isolated((url, body) => {
      const data = JSON.parse(body)
      return url.includes('recommend') ? JSON.stringify({ ...data, data: [2] }) : undefined
    })
    uninstall = installMainWorld({ readyTimeout: 50, hydrationTimeout: 60_000 })
  })

  afterEach(() => {
    uninstall()
    side.close()
    window.fetch = origFetch
  })

  test('安装时打招呼；就绪后改写数据接口的响应', async () => {
    expect(side.types()).toEqual(['hello'])
    side.ready()
    const res = await window.fetch(API)
    expect(await res.json()).toEqual({ data: [2], url: API })
    expect(res.url).toBe('')
    expect(res.status).toBe(200)
    expect(side.messages.at(-1)?.head).toMatchObject({ type: 'response', url: API })
  })

  test('其他接口原样放行，不经过隔离环境', async () => {
    side.ready()
    const res = await window.fetch('https://www.zhihu.com/api/v4/me')
    expect(await res.json()).toMatchObject({ data: [1, 2, 3] })
    expect(side.types()).toEqual(['hello'])
  })

  test('等待隔离环境就绪；超时后原样放行', async () => {
    const pending = window.fetch(API)
    await flush()
    expect(side.types()).toEqual(['hello'])
    const res = await pending
    expect(await res.json()).toMatchObject({ data: [1, 2, 3] })
    // 超时之后才就绪：后面的请求照常处理
    side.ready()
    expect(await (await window.fetch(API)).json()).toMatchObject({ data: [2] })
  })

  test('隔离环境不需要改写时返回原来的响应', async () => {
    side.close()
    side = isolated(() => undefined)
    side.ready()
    const res = await window.fetch(`${API}&x=1`)
    expect(await res.json()).toMatchObject({ data: [1, 2, 3] })
  })

  test('非 JSON 或失败的响应不处理', async () => {
    side.ready()
    window.fetch = origFetch
    uninstall()
    window.fetch = vi.fn(async () => new Response('oops', { status: 500 })) as typeof fetch
    uninstall = installMainWorld({ readyTimeout: 50 })
    side.ready()
    const res = await window.fetch(API)
    expect(res.status).toBe(500)
    expect(side.types().filter(t => t === 'response')).toEqual([])
  })

  test('卸载后还原 fetch', () => {
    uninstall()
    expect(window.fetch).not.toBe(origFetch)
    expect(vi.isMockFunction(window.fetch)).toBe(true)
    uninstall = () => {}
  })
})

/** 模拟浏览器的 XMLHttpRequest：responseText / response 是原型上的 getter */
class FakeXHR {
  readyState = 0
  status = 0
  responseType: XMLHttpRequestResponseType = ''
  responseURL = ''
  body = ''
  url = ''
  open(_method: string, url: string) {
    this.url = url
  }
  getResponseHeader(name: string) {
    return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null
  }
  finish(body: unknown) {
    this.body = JSON.stringify(body)
    this.readyState = 4
    this.status = 200
    this.responseURL = this.url
  }
}
Object.defineProperty(FakeXHR.prototype, 'responseText', {
  configurable: true,
  get(this: FakeXHR) {
    if (this.responseType !== '' && this.responseType !== 'text') throw new Error('InvalidStateError')
    return this.body
  },
})
Object.defineProperty(FakeXHR.prototype, 'response', {
  configurable: true,
  get(this: FakeXHR) {
    return this.responseType === 'json' ? JSON.parse(this.body) : this.body
  },
})

describe('XMLHttpRequest', () => {
  const origXHR = window.XMLHttpRequest
  let uninstall: () => void
  let side: ReturnType<typeof isolated>

  beforeEach(() => {
    ;(window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR
    side = isolated((_url, body) => JSON.stringify({ ...JSON.parse(body), data: ['kept'] }))
    uninstall = installMainWorld({ readyTimeout: 50 })
  })

  afterEach(() => {
    uninstall()
    side.close()
    ;(window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = origXHR
  })

  const request = (url: string, responseType: XMLHttpRequestResponseType = '') => {
    const xhr = new FakeXHR() as unknown as XMLHttpRequest & FakeXHR
    xhr.open('GET', url)
    xhr.responseType = responseType
    xhr.finish({ data: ['a', 'b'] })
    return xhr
  }

  test('读取响应时同步改写，多次读取结果一致', () => {
    side.ready()
    const xhr = request(API)
    expect(JSON.parse(xhr.responseText)).toEqual({ data: ['kept'] })
    expect(JSON.parse(xhr.response)).toEqual({ data: ['kept'] })
    expect(side.types().filter(t => t === 'response')).toHaveLength(1)
  })

  test('responseType 为 json', () => {
    side.ready()
    const xhr = request(API, 'json')
    expect(xhr.response).toEqual({ data: ['kept'] })
    expect(() => xhr.responseText).toThrow()
  })

  test('还没就绪时原样放行', () => {
    const xhr = request(API)
    expect(JSON.parse(xhr.responseText)).toEqual({ data: ['a', 'b'] })
    side.ready()
    // 同一个请求的结果不会中途改变
    expect(JSON.parse(xhr.responseText)).toEqual({ data: ['a', 'b'] })
  })

  test('其他接口、未完成的请求不处理', () => {
    side.ready()
    expect(JSON.parse(request('https://www.zhihu.com/api/v4/me').responseText)).toEqual({ data: ['a', 'b'] })
    const xhr = new FakeXHR() as unknown as XMLHttpRequest & FakeXHR
    xhr.open('GET', API)
    expect(xhr.responseText).toBe('')
    expect(side.types().filter(t => t === 'response')).toHaveLength(0)
  })
})

describe('路由、React 属性、激活', () => {
  let uninstall: () => void
  let side: ReturnType<typeof isolated>

  beforeEach(() => {
    side = isolated()
    uninstall = installMainWorld({ readyTimeout: 50, hydrationTimeout: 60_000 })
  })

  afterEach(() => {
    uninstall()
    side.close()
    document.body.replaceChildren()
    history.replaceState(null, '', '/')
  })

  test('pushState / replaceState 换了地址时通知，只改 # 时不通知', () => {
    history.pushState(null, '', '/question/1')
    history.replaceState(null, '', '/question/1#answer')
    history.pushState(null, '', '/hot')
    const routes = side.messages.filter(m => m.head.type === 'route').map(m => (m.head as { url: string }).url)
    expect(routes).toEqual(['https://www.zhihu.com/question/1', 'https://www.zhihu.com/hot'])
  })

  test('重复安装不会生效', () => {
    const again = installMainWorld()
    history.pushState(null, '', '/follow')
    expect(side.messages.filter(m => m.head.type === 'route')).toHaveLength(1)
    again()
  })

  test('替隔离环境读取 React 属性', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const fiber = {
      memoizedProps: { className: 'x' },
      return: {
        memoizedProps: { data: { id: 'feed-1', type: 'feed', target: { id: 11, type: 'answer' } } },
        return: { memoizedProps: { answer: { id: '11', type: 'answer' }, question: { id: '9', type: 'question' } } },
      },
    }
    Object.assign(el, { __reactFiber$abc: fiber })
    el.dispatchEvent(new CustomEvent(ASK_REACT, { bubbles: true }))
    const reply = side.messages.find(m => m.head.type === 'react')
    expect(reply?.head).toEqual({ type: 'react', refs: [{ type: 'answer', id: '11' }] })
    expect(reactRefs(document.createElement('div'))).toEqual([])
  })

  test('知乎前端激活后通知一次；就绪时补发', async () => {
    vi.useFakeTimers()
    try {
      uninstall()
      uninstall = installMainWorld({ hydrationTimeout: 60_000 })
      const root = document.createElement('div')
      root.id = 'root'
      const card = document.createElement('div')
      card.className = 'ContentItem'
      root.append(card)
      document.body.append(root)
      vi.advanceTimersByTime(300)
      expect(side.types()).not.toContain('hydrated')
      Object.assign(card, { __reactFiber$x: {} })
      // 看到之后还要再等一小会儿
      vi.advanceTimersByTime(200)
      expect(side.types()).not.toContain('hydrated')
      vi.advanceTimersByTime(300)
      expect(side.types().filter(t => t === 'hydrated')).toHaveLength(1)
      side.ready()
      expect(side.types().filter(t => t === 'hydrated')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  test('一直看不到 React 的内部属性时，超时后当作已激活', () => {
    vi.useFakeTimers()
    try {
      uninstall()
      uninstall = installMainWorld({ hydrationTimeout: 1000 })
      vi.advanceTimersByTime(900)
      expect(side.types()).not.toContain('hydrated')
      vi.advanceTimersByTime(300)
      expect(side.types().filter(t => t === 'hydrated')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
