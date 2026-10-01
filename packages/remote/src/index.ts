// 用户插件的跨环境运行。
// 运行时（runtime.ts）在用户脚本环境里，代理（proxy.ts）在扩展隔离环境里，两边用 wire.ts 的同步 RPC 通信。

export type { ElementReceiver, ElementSharer, Side } from './dom'
export { domElementReceiver, domElementSharer, domTransport, memoryElements } from './dom'
export type * from './protocol'
export { NO_RUNTIME_MESSAGE, type RemotePluginOptions, remotePlugin } from './proxy'
export { type Runtime, type RuntimeOptions, startRuntime } from './runtime'
export { boot } from './runtime-entry'
export { Endpoint, memoryTransports, RemoteError, type Transport } from './wire'
