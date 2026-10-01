import { describe, expect, test, vi } from 'vitest'
import { domElementReceiver, domElementSharer, domTransport } from '../src/dom'
import { Endpoint } from '../src/wire'

describe('DOM 传输层', () => {
  test('两侧通过事件同步通信', () => {
    const host = new Endpoint(domTransport(document, 'k1', 'host'))
    const runtime = new Endpoint(domTransport(document, 'k1', 'runtime'))
    runtime.handle<{ n: number }>('inc', ({ n }) => n + 1)
    host.handle('hi', () => '你好')
    expect(host.callSync('inc', { n: 1 })).toBe(2)
    expect(runtime.callSync('hi')).toBe('你好')
    host.close()
    runtime.close()
  })

  test('通道名不同的互相听不到：页面脚本不知道通道名就没法伪造消息', () => {
    const real = new Endpoint(domTransport(document, 'secret-123', 'host'))
    const handler = vi.fn()
    real.handle('act', handler)
    // 页面脚本猜一个通道名，或者伪造一个同方向的事件
    const attacker = new Endpoint(domTransport(document, 'guess', 'runtime'))
    attacker.notify('act')
    document.dispatchEvent(new CustomEvent('zb:secret:r2h', { detail: '{"k":"call","id":0,"m":"act","reply":false}' }))
    expect(handler).not.toHaveBeenCalled()
    real.close()
    attacker.close()
  })

  test('detail 不是字符串的事件被忽略', () => {
    const real = new Endpoint(domTransport(document, 'k2', 'host'))
    const handler = vi.fn()
    real.handle('act', handler)
    document.dispatchEvent(new CustomEvent('zb:k2:r2h', { detail: { k: 'call', m: 'act' } }))
    expect(handler).not.toHaveBeenCalled()
    real.close()
  })

  test('关闭后不再收到消息', () => {
    const host = new Endpoint(domTransport(document, 'k3', 'host'))
    const runtime = new Endpoint(domTransport(document, 'k3', 'runtime'))
    const seen = vi.fn()
    runtime.handle('x', seen)
    runtime.close()
    host.notify('x')
    expect(seen).not.toHaveBeenCalled()
    host.close()
  })
})

describe('元素传递', () => {
  test('用事件把元素本身递过去，包括 Shadow DOM 里的元素', () => {
    const sharer = domElementSharer('el1')
    const receiver = domElementReceiver(document, 'el1')
    const plain = document.createElement('div')
    document.body.append(plain)
    const holder = document.createElement('div')
    document.body.append(holder)
    const shadow = holder.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    shadow.append(inner)

    sharer.share(plain, 't1')
    sharer.share(inner, 't2')
    expect(receiver.take('t1')).toBe(plain)
    expect(receiver.take('t2')).toBe(inner)
    expect(receiver.take('t3')).toBeUndefined()
    receiver.release('t1')
    expect(receiver.take('t1')).toBeUndefined()
    receiver.close()
    sharer.share(plain, 't4')
    expect(receiver.take('t4')).toBeUndefined()
    plain.remove()
    holder.remove()
  })

  test('通道名不同的收不到', () => {
    const receiver = domElementReceiver(document, 'el2')
    const el = document.createElement('div')
    domElementSharer('other').share(el, 't')
    expect(receiver.take('t')).toBeUndefined()
    receiver.close()
  })
})
