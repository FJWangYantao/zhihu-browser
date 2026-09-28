// 设置和插件数据的持久化：chrome.storage.local。数据只保存在本机，不同步、不上传。
//
// 键的布局：
//   settings:<插件 id>        插件设置（对象）
//   data:<插件 id>:<键>        插件存储（z.storage）
//   plugins                  各插件的启用状态 { [插件 id]: { enabled: boolean } }
//   safeMode                 安全模式（boolean）
//
// 官方插件在扩展隔离环境里直接读写这里，不经过后台：后台可能被浏览器回收，不能放在插件启动的关键路径上。

import type { SettingsBackend, StorageBackend } from '@zhihu-browser/core'

export const SETTINGS_PREFIX = 'settings:'
export const DATA_PREFIX = 'data:'
export const PLUGINS_KEY = 'plugins'
export const SAFE_MODE_KEY = 'safeMode'

export type PluginStates = Record<string, { enabled: boolean }>

interface StorageChange {
  newValue?: unknown
  oldValue?: unknown
}

/** 用到的 storage API（便于测试时替换） */
export interface StorageApi {
  local: {
    get(keys: string | string[] | null): Promise<Record<string, unknown>>
    set(items: Record<string, unknown>): Promise<void>
    remove(keys: string | string[]): Promise<void>
  }
  onChanged: {
    addListener(listener: (changes: Record<string, StorageChange>, areaName: string) => void): void
    removeListener(listener: (changes: Record<string, StorageChange>, areaName: string) => void): void
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 监听 local 区域里某些键的变化（设置页、其他标签页修改时） */
export function watch(
  api: StorageApi,
  match: (key: string) => boolean,
  onChange: (key: string, value: unknown) => void,
) {
  const listener = (changes: Record<string, StorageChange>, areaName: string) => {
    if (areaName !== 'local') return
    for (const [key, change] of Object.entries(changes)) if (match(key)) onChange(key, change.newValue)
  }
  api.onChanged.addListener(listener)
  return () => api.onChanged.removeListener(listener)
}

export function createSettingsBackend(api: StorageApi): SettingsBackend {
  return {
    async load(pluginId) {
      const key = SETTINGS_PREFIX + pluginId
      const value = (await api.local.get(key))[key]
      return isRecord(value) ? value : {}
    },
    async save(pluginId, values) {
      await api.local.set({ [SETTINGS_PREFIX + pluginId]: values })
    },
    subscribe(pluginId, onChange) {
      const key = SETTINGS_PREFIX + pluginId
      // 键被删除（设置页"恢复默认"）时 newValue 为 undefined：按空对象处理，宿主会换成默认值
      return watch(
        api,
        k => k === key,
        (_k, value) => onChange(isRecord(value) ? value : {}),
      )
    },
  }
}

export function createStorageBackend(api: StorageApi): StorageBackend {
  const keyOf = (namespace: string, key: string) => `${DATA_PREFIX}${namespace}:${key}`
  return {
    async get(namespace, key) {
      const k = keyOf(namespace, key)
      return (await api.local.get(k))[k]
    },
    async set(namespace, key, value) {
      await api.local.set({ [keyOf(namespace, key)]: value })
    },
    async delete(namespace, key) {
      await api.local.remove(keyOf(namespace, key))
    },
    async keys(namespace) {
      const prefix = keyOf(namespace, '')
      return Object.keys(await api.local.get(null))
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length))
    },
  }
}

export interface ExtensionState {
  safeMode: boolean
  plugins: PluginStates
}

export async function readState(api: StorageApi): Promise<ExtensionState> {
  const stored = await api.local.get([SAFE_MODE_KEY, PLUGINS_KEY])
  return { safeMode: stored[SAFE_MODE_KEY] === true, plugins: toPluginStates(stored[PLUGINS_KEY]) }
}

export function toPluginStates(value: unknown): PluginStates {
  const out: PluginStates = {}
  if (!isRecord(value)) return out
  for (const [id, state] of Object.entries(value)) {
    if (isRecord(state) && typeof state.enabled === 'boolean') out[id] = { enabled: state.enabled }
  }
  return out
}

/** 插件没有记录时默认启用 */
export const isEnabled = (states: PluginStates, id: string) => states[id]?.enabled ?? true
