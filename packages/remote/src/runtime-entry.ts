// 用户脚本环境里的入口：被打包成一个脚本，和插件代码一起注册进 userScripts。
//
//   boot(channel, factory)
//     channel  这个插件的通道密钥（也决定 DOM 事件的名字）
//     factory  插件文件转译后的代码，包成 function (exports) { … }；顶层代码在 start 时才执行
//
// 同一个用户脚本环境里重复执行（热重载时由后台用 userScripts.execute 执行新代码）时，
// 新的运行时先销毁旧的，再接管通道。

import { domElementReceiver, domTransport } from './dom'
import { type Runtime, startRuntime } from './runtime'

interface BootState {
  runtimes: Map<string, Runtime>
}

const KEY = '__zbRuntimes'

export function boot(channel: string, factory: (exports: Record<string, unknown>) => void): Runtime {
  const g = globalThis as typeof globalThis & { [KEY]?: BootState }
  const state: BootState = g[KEY] ?? { runtimes: new Map() }
  g[KEY] = state
  state.runtimes.get(channel)?.destroy()
  const runtime = startRuntime({
    transport: domTransport(document, channel, 'runtime'),
    elements: domElementReceiver(document, channel),
    load() {
      const exports: Record<string, unknown> = {}
      factory(exports)
      return exports
    },
  })
  state.runtimes.set(channel, runtime)
  return runtime
}
