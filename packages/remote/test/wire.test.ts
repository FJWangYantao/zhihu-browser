import { describe, expect, test, vi } from 'vitest'
import { Endpoint, memoryTransports, RemoteError } from '../src/wire'

function pair() {
  const [a, b] = memoryTransports()
  return { left: new Endpoint(a), right: new Endpoint(b) }
}

describe('Endpoint', () => {
  test('同步调用立刻拿到结果', () => {
    const { left, right } = pair()
    right.handle<{ n: number }>('double', ({ n }) => n * 2)
    expect(left.callSync('double', { n: 21 })).toBe(42)
  })

  test('结果和参数可以是 undefined、null 和嵌套对象', () => {
    const { left, right } = pair()
    right.handle('nothing', () => undefined)
    right.handle('null', () => null)
    right.handle('echo', (a: unknown) => a)
    expect(left.callSync('nothing')).toBeUndefined()
    expect(left.callSync('null')).toBeNull()
    expect(left.callSync('echo', { a: [1, { b: '中文' }] })).toEqual({ a: [1, { b: '中文' }] })
  })

  test('对方抛出的错误原样带回', () => {
    const { left, right } = pair()
    right.handle('boom', () => {
      throw new Error('坏了')
    })
    expect(() => left.callSync('boom')).toThrow(new RemoteError('坏了'))
  })

  test('没有处理函数时报错', () => {
    const { left } = pair()
    expect(() => left.callSync('nope')).toThrow('没有处理函数')
  })

  test('没有人在监听时报错，而不是返回 undefined', () => {
    const [a] = memoryTransports()
    expect(() => new Endpoint(a).callSync('x')).toThrow('没有同步回复')
  })

  test('同步调用异步处理函数时报错；异步调用可以', async () => {
    const { left, right } = pair()
    right.handle('slow', async () => {
      await Promise.resolve()
      return 'done'
    })
    expect(() => left.callSync('slow')).toThrow('没有同步回复')
    await expect(left.call('slow')).resolves.toBe('done')
  })

  test('异步调用：同步处理的结果、异步处理的失败都能收到', async () => {
    const { left, right } = pair()
    right.handle('fast', () => 1)
    right.handle('fail', async () => {
      throw new Error('异步坏了')
    })
    await expect(left.call('fast')).resolves.toBe(1)
    await expect(left.call('fail')).rejects.toThrow('异步坏了')
  })

  test('通知不等回复，对方出错也不影响', () => {
    const { left, right } = pair()
    const seen = vi.fn()
    right.handle('note', seen)
    right.handle('bad', () => {
      throw new Error('x')
    })
    left.notify('note', { a: 1 })
    left.notify('bad')
    left.notify('nobody')
    expect(seen).toHaveBeenCalledWith({ a: 1 })
  })

  test('处理函数里可以反过来调用对方（重入）', () => {
    const { left, right } = pair()
    left.handle<number>('add', n => n + 1)
    right.handle<number>('twice', n => (right.callSync('add', n) as number) + 1)
    expect(left.callSync('twice', 1)).toBe(3)
  })

  test('关闭后调用失败，等待中的异步调用被拒绝', async () => {
    const { left, right } = pair()
    right.handle('hang', () => new Promise(() => {}))
    const waiting = left.call('hang')
    left.close()
    await expect(waiting).rejects.toThrow('通道已关闭')
    expect(() => left.callSync('x')).toThrow('通道已关闭')
    await expect(left.call('x')).rejects.toThrow('通道已关闭')
  })

  test('忽略格式不对的帧', () => {
    const [a, b] = memoryTransports()
    const endpoint = new Endpoint(b)
    const seen = vi.fn()
    endpoint.handle('x', seen)
    for (const junk of ['', 'not json', 'null', '123', '{"k":"call"}', '{"k":"call","m":5}']) a.send(junk)
    expect(seen).not.toHaveBeenCalled()
  })
})
