// 设置页用到的全部状态，从 chrome.storage 读取。

import { type Keymap, sanitizeSettings } from '@zhihu-browser/core'
import type { PluginMeta } from '@zhihu-browser/sdk'
import {
  KEYMAP_KEY,
  PALETTE_KEYS_KEY,
  PLUGINS_KEY,
  type PluginStates,
  REGISTRY_KEY,
  type Registry,
  readState,
  SAFE_MODE_KEY,
  SETTINGS_PREFIX,
  type StorageApi,
  toRegistry,
} from '../../src/storage'
import { toIndex, USER_PLUGINS_KEY, type UserPluginIndex } from '../../src/user-plugins/store'

export interface OptionsState {
  safeMode: boolean
  plugins: PluginStates
  /** 各插件的设置，已经补上默认值 */
  settings: Record<string, Record<string, unknown>>
  keymap: Keymap
  /** 没有设置过时是 undefined（用默认的） */
  paletteKeys?: string
  /** 知乎页面上登记的快捷键；还没打开过知乎页面时没有 */
  registry?: Registry
  /** 已安装的用户插件 */
  userPlugins: UserPluginIndex
}

/** 这些键变化时，设置页重新读取 */
export const watchedKey = (key: string) =>
  key === SAFE_MODE_KEY ||
  key === PLUGINS_KEY ||
  key === KEYMAP_KEY ||
  key === PALETTE_KEYS_KEY ||
  key === REGISTRY_KEY ||
  key === USER_PLUGINS_KEY ||
  key.startsWith(SETTINGS_PREFIX)

export async function loadOptionsState(
  api: StorageApi,
  plugins: readonly { meta: PluginMeta }[],
): Promise<OptionsState> {
  const base = await readState(api)
  const userPlugins = toIndex((await api.local.get(USER_PLUGINS_KEY))[USER_PLUGINS_KEY])
  const all = [...plugins, ...Object.values(userPlugins)]
  const stored = await api.local.get([...all.map(p => SETTINGS_PREFIX + p.meta.id), REGISTRY_KEY])
  const settings: OptionsState['settings'] = {}
  for (const { meta } of all) {
    const value = stored[SETTINGS_PREFIX + meta.id]
    const values = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
    settings[meta.id] = sanitizeSettings(meta, values).values
  }
  const registry = toRegistry(stored[REGISTRY_KEY])
  return { ...base, settings, userPlugins, ...(registry ? { registry } : {}) }
}
