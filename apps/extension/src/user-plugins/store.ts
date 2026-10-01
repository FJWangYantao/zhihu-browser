// 用户插件的持久化：chrome.storage.local。
//
// 键的布局：
//   userPlugins          索引 { [插件 id]: UserPluginEntry }：体积小，知乎页面启动时一次读出
//   userCode:<插件 id>    { source, code }：源码和转译后的脚本，只有后台和设置页读写
//
// 插件的设置、存储沿用官方插件的键（settings:<id>、data:<id>:…）。

import type { PluginMeta } from '@zhihu-browser/sdk'
import type { StorageApi } from '../storage'

export const USER_PLUGINS_KEY = 'userPlugins'
export const USER_CODE_PREFIX = 'userCode:'

export interface UserPluginEntry {
  meta: PluginMeta
  /** 通道密钥：只存在于扩展的存储和用户脚本的注册代码里，页面脚本不知道 */
  secret: string
  enabled: boolean
  installedAt: number
  updatedAt: number
  /** 每次安装、更新加一：知乎页面据此知道要重新加载这个插件 */
  rev: number
}

export type UserPluginIndex = Record<string, UserPluginEntry>

export interface UserPluginCode {
  source: string
  code: string
  fileName?: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function toEntry(value: unknown): UserPluginEntry | undefined {
  if (!isRecord(value) || !isRecord(value.meta) || typeof value.meta.id !== 'string') return undefined
  if (typeof value.secret !== 'string' || value.secret.length < 16) return undefined
  return {
    meta: value.meta as unknown as PluginMeta,
    secret: value.secret,
    enabled: value.enabled === true,
    installedAt: typeof value.installedAt === 'number' ? value.installedAt : 0,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    rev: typeof value.rev === 'number' ? value.rev : 0,
  }
}

export function toIndex(value: unknown): UserPluginIndex {
  const index: UserPluginIndex = {}
  if (!isRecord(value)) return index
  for (const [id, raw] of Object.entries(value)) {
    const entry = toEntry(raw)
    if (entry && entry.meta.id === id) index[id] = entry
  }
  return index
}

export async function readIndex(api: StorageApi): Promise<UserPluginIndex> {
  return toIndex((await api.local.get(USER_PLUGINS_KEY))[USER_PLUGINS_KEY])
}

export async function writeIndex(api: StorageApi, index: UserPluginIndex): Promise<void> {
  await api.local.set({ [USER_PLUGINS_KEY]: index })
}

export async function readCode(api: StorageApi, id: string): Promise<UserPluginCode | undefined> {
  const value = (await api.local.get(USER_CODE_PREFIX + id))[USER_CODE_PREFIX + id]
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.code !== 'string') return undefined
  return {
    source: value.source,
    code: value.code,
    ...(typeof value.fileName === 'string' ? { fileName: value.fileName } : {}),
  }
}

export async function writeCode(api: StorageApi, id: string, code: UserPluginCode): Promise<void> {
  await api.local.set({ [USER_CODE_PREFIX + id]: code })
}

/** 128 位的随机密钥（十六进制） */
export function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
