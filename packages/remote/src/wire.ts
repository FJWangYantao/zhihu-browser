// 两个环境之间的同步通信：一问一答的 RPC。
//
// 传输层（Transport）只负责把一个字符串送到对方；浏览器里用 DOM 自定义事件实现（见 dom.ts），
// dispatchEvent 是同步的：对方的监听函数执行完才返回，所以一次调用可以立刻拿到回复。
// 过滤函数必须在知乎渲染之前同步给出结果，这是整套设计只能用同步通道的原因。
//
// 参数和结果必须能被 JSON 序列化。

import type { Dispose } from '@zhihu-browser/sdk'

export interface Transport {
  /** 把一帧数据发给对方。对方的监听函数在 send 返回之前同步执行。 */
  send(frame: string): void
  /** 监听对方发来的数据 */
  listen(on: (frame: string) => void): Dispose
}

type Frame =
  | { k: 'call'; id: number; m: string; a?: unknown; reply: boolean }
  | { k: 'ret'; id: number; v?: unknown; e?: string }

/** 对方的处理函数抛出的错误（消息原样保留）。 */
export class RemoteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteError'
  }
}

export type Handler = (args: never) => unknown

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class Endpoint {
  private readonly handlers = new Map<string, Handler>()
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  /** 正在同步等待回复的调用，和它已经收到的回复 */
  private readonly syncWaiting = new Map<number, Frame & { k: 'ret' }>()
  private nextId = 1
  private closed = false
  private readonly stop: Dispose

  constructor(private readonly transport: Transport) {
    this.stop = transport.listen(frame => this.receive(frame))
  }

  /** 登记处理函数。返回 Promise 的处理函数只能用 call() 调用，不能用 callSync()。 */
  handle<A>(method: string, fn: (args: A) => unknown): void {
    this.handlers.set(method, fn as Handler)
  }

  /** 发出通知，不等回复，对方出错也不会知道。 */
  notify(method: string, args?: unknown): void {
    if (this.closed) return
    this.send({ k: 'call', id: 0, m: method, ...(args === undefined ? {} : { a: args }), reply: false })
  }

  /** 同步调用：对方必须同步处理并回复，否则抛出错误。 */
  callSync<T = unknown>(method: string, args?: unknown): T {
    if (this.closed) throw new RemoteError('通道已关闭')
    const id = this.nextId++
    this.syncWaiting.set(id, undefined as never)
    let ret: (Frame & { k: 'ret' }) | undefined
    try {
      this.send({ k: 'call', id, m: method, ...(args === undefined ? {} : { a: args }), reply: true })
    } finally {
      ret = this.syncWaiting.get(id)
      this.syncWaiting.delete(id)
    }
    if (!ret) throw new RemoteError(`对方没有同步回复 ${method}（没有人在监听，或处理函数是异步的）`)
    if (ret.e !== undefined) throw new RemoteError(ret.e)
    return ret.v as T
  }

  /** 异步调用：等对方回复（对方的处理函数可以是异步的）。 */
  call<T = unknown>(method: string, args?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new RemoteError('通道已关闭'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      try {
        this.send({ k: 'call', id, m: method, ...(args === undefined ? {} : { a: args }), reply: true })
      } catch (e) {
        this.pending.delete(id)
        reject(e instanceof Error ? e : new RemoteError(String(e)))
      }
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.stop()
    for (const { reject } of this.pending.values()) reject(new RemoteError('通道已关闭'))
    this.pending.clear()
    this.syncWaiting.clear()
    this.handlers.clear()
  }

  private send(frame: Frame): void {
    this.transport.send(JSON.stringify(frame))
  }

  private receive(raw: string): void {
    if (this.closed) return
    let frame: Frame
    try {
      frame = JSON.parse(raw) as Frame
    } catch {
      return
    }
    if (typeof frame !== 'object' || frame === null) return
    if (frame.k === 'call' && typeof frame.m === 'string') this.onCall(frame)
    else if (frame.k === 'ret') this.onReturn(frame)
  }

  private onCall(frame: Frame & { k: 'call' }): void {
    const handler = this.handlers.get(frame.m)
    const reply = (ret: Omit<Frame & { k: 'ret' }, 'k' | 'id'>) => {
      if (frame.reply && !this.closed) this.send({ k: 'ret', id: frame.id, ...ret })
    }
    if (!handler) {
      reply({ e: `没有处理函数：${frame.m}` })
      return
    }
    let result: unknown
    try {
      result = (handler as (a: unknown) => unknown)(frame.a)
    } catch (e) {
      reply({ e: message(e) })
      return
    }
    if (typeof (result as { then?: unknown } | null)?.then === 'function') {
      ;(result as Promise<unknown>).then(
        v => reply(v === undefined ? {} : { v }),
        e => reply({ e: message(e) }),
      )
    } else reply(result === undefined ? {} : { v: result })
  }

  private onReturn(frame: Frame & { k: 'ret' }): void {
    if (this.syncWaiting.has(frame.id)) {
      this.syncWaiting.set(frame.id, frame)
      return
    }
    const waiter = this.pending.get(frame.id)
    if (!waiter) return
    this.pending.delete(frame.id)
    if (frame.e !== undefined) waiter.reject(new RemoteError(frame.e))
    else waiter.resolve(frame.v)
  }
}

/** 内存里的一对传输层（测试用）：一端 send，另一端的监听函数同步收到。 */
export function memoryTransports(): [Transport, Transport] {
  const make = (inbox: Set<(frame: string) => void>, outbox: Set<(frame: string) => void>): Transport => ({
    send(frame) {
      for (const fn of [...outbox]) fn(frame)
    },
    listen(on) {
      inbox.add(on)
      return () => inbox.delete(on)
    },
  })
  const a = new Set<(frame: string) => void>()
  const b = new Set<(frame: string) => void>()
  return [make(a, b), make(b, a)]
}
