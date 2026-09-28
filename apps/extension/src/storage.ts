// 设置和插件数据的持久化：chrome.storage.local。数据只保存在本机，不同步、不上传。
//
// 键的布局：
//   settings:<插件 id>        插件设置（对象）
//   data:<插件 id>:<键>        插件存储（z.storage）
//   plugins                  各插件的启用状态 { [插件 id]: { enabled: boolean } }
//   safeMode                 安全模式（boolean）
//   keymap                   用户改过的快捷键 { [快捷键 id]: 新的写法 }，空字符串表示停用
//   paletteKeys              打开命令面板的快捷键；没有时用默认的 mod+k，空字符串表示不用快捷键
//   registry                 知乎页面上登记的快捷键（由内容脚本写入，设置页据此列出可以改的快捷键）
//
// 官方插件在扩展隔离环境里直接读写这里，不经过后台：后台可能被浏览器回收，不能放在插件启动的关键路径上。

import type { Keymap, Platform, SettingsBackend, ShortcutInfo, StorageBackend } from '@zhihu-browser/core'

export const SETTINGS_PREFIX = 'settings:'
export const DATA_PREFIX = 'data:'
export const PLUGINS_KEY = 'plugins'
export const SAFE_MODE_KEY = 'safeMode'
export const KEYMAP_KEY = 'keymap'
export const PALETTE_KEYS_KEY = 'paletteKeys'
export const REGISTRY_KEY = 'registry'

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
  keymap: Keymap
  /** 没有设置过时是 undefined（用默认的） */
  paletteKeys?: string
}

export async function readState(api: StorageApi): Promise<ExtensionState> {
  const stored = await api.local.get([SAFE_MODE_KEY, PLUGINS_KEY, KEYMAP_KEY, PALETTE_KEYS_KEY])
  const paletteKeys = stored[PALETTE_KEYS_KEY]
  return {
    safeMode: stored[SAFE_MODE_KEY] === true,
    plugins: toPluginStates(stored[PLUGINS_KEY]),
    keymap: toKeymap(stored[KEYMAP_KEY]),
    ...(typeof paletteKeys === 'string' ? { paletteKeys } : {}),
  }
}

export function toKeymap(value: unknown): Keymap {
  const out: Keymap = {}
  if (!isRecord(value)) return out
  for (const [id, keys] of Object.entries(value)) if (typeof keys === 'string') out[id] = keys
  return out
}

/** 知乎页面上登记的快捷键，写给设置页看 */
export interface Registry {
  platform: Platform
  shortcuts: ShortcutInfo[]
}

export function toRegistry(value: unknown): Registry | undefined {
  if (!isRecord(value) || (value.platform !== 'mac' && value.platform !== 'other') || !Array.isArray(value.shortcuts)) {
    return undefined
  }
  return value as unknown as Registry
}

/** 写入登记的快捷键；和已有的一样时不写，免得每个标签页打开时都触发一次变化通知 */
export async function saveRegistry(api: StorageApi, registry: Registry): Promise<boolean> {
  const current = (await api.local.get(REGISTRY_KEY))[REGISTRY_KEY]
  if (JSON.stringify(current) === JSON.stringify(registry)) return false
  await api.local.set({ [REGISTRY_KEY]: registry })
  return true
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
