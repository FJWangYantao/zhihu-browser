// 知乎页面里（扩展隔离环境）把已安装的用户插件接到宿主上。
// 每个用户插件对应一个代理模块（packages/remote）：它通过插件自己的通道，驱动用户脚本环境里的 SDK 运行时。

import type { Host } from '@zhihu-browser/core'
import { domElementSharer, domTransport, Endpoint, NO_RUNTIME_MESSAGE, remotePlugin } from '@zhihu-browser/remote'
import { type StorageApi, watch } from '../storage'
import { toIndex, USER_PLUGINS_KEY, type UserPluginEntry, type UserPluginIndex } from './store'

export interface UserPluginConnection {
  /** 第一次同步完成（每个插件都启动完成或失败） */
  ready: Promise<void>
  stop(): void
}

export function connectUserPlugins(options: { host: Host; api: StorageApi; doc: Document }): UserPluginConnection {
  const { host, api, doc } = options
  const loaded = new Map<string, { rev: number; secret: string; stopWatching?: () => void }>()
  let chain: Promise<void> = Promise.resolve()

  const module = (entry: UserPluginEntry) =>
    remotePlugin({
      meta: entry.meta,
      transport: domTransport(doc, entry.secret, 'host'),
      elements: domElementSharer(entry.secret),
    })

  /** 运行时晚于启动超时才出现（例如刚打开"允许用户脚本"）：出现时自动重试 */
  function retryWhenRuntimeAppears(entry: UserPluginEntry): () => void {
    const endpoint = new Endpoint(domTransport(doc, entry.secret, 'host'))
    endpoint.handle('hello', () => {
      endpoint.close()
      if (host.plugin(entry.meta.id)?.state === 'failed') void host.enable(entry.meta.id).catch(() => {})
    })
    return () => endpoint.close()
  }

  async function start(entry: UserPluginEntry): Promise<void> {
    const id = entry.meta.id
    const record = { rev: entry.rev, secret: entry.secret } as {
      rev: number
      secret: string
      stopWatching?: () => void
    }
    loaded.set(id, record)
    try {
      const info = await host.load(module(entry), { enabled: entry.enabled })
      if (entry.enabled && info.state === 'failed' && info.reason?.includes(NO_RUNTIME_MESSAGE)) {
        record.stopWatching = retryWhenRuntimeAppears(entry)
      }
    } catch (e) {
      console.error(`[zhihu-browser] 加载用户插件 ${id} 失败`, e)
    }
  }

  function remove(id: string): void {
    loaded.get(id)?.stopWatching?.()
    loaded.delete(id)
    if (host.plugin(id)) host.unload(id)
  }

  async function sync(index: UserPluginIndex): Promise<void> {
    for (const id of [...loaded.keys()]) if (!index[id]) remove(id)
    const starting: Promise<void>[] = []
    for (const entry of Object.values(index)) {
      const previous = loaded.get(entry.meta.id)
      if (previous?.rev === entry.rev && previous.secret === entry.secret) continue
      if (previous) remove(entry.meta.id)
      starting.push(start(entry))
    }
    // 各插件并行启动：一个插件没有响应时不拖住其他插件
    await Promise.all(starting)
  }

  const enqueue = (index: UserPluginIndex) => {
    chain = chain.then(() => sync(index)).catch(e => console.error('[zhihu-browser] 同步用户插件出错', e))
    return chain
  }

  // 读不到存储时也不能拖垮页面：用户插件不可用，官方插件照常运行
  const ready = api.local
    .get(USER_PLUGINS_KEY)
    .then(stored => enqueue(toIndex(stored[USER_PLUGINS_KEY])))
    .catch(e => console.error('[zhihu-browser] 读取用户插件失败', e))
  const stopWatching = watch(
    api,
    key => key === USER_PLUGINS_KEY,
    (_key, value) => void enqueue(toIndex(value)),
  )

  return {
    ready,
    stop() {
      stopWatching()
      for (const id of [...loaded.keys()]) remove(id)
    },
  }
}

/** 页面上等用户插件的最长时间（毫秒）：超时就先开始处理页面，插件之后上线 */
export const USER_PLUGINS_WAIT_MS = 300
