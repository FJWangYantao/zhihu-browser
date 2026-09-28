// 数据包：某个插件的一份配置预设（屏蔽列表、主题等），不含代码。格式见插件 API 文档第 16 节。

import type { PluginMeta } from '@zhihu-browser/sdk'
import { checkSettingValue, defaultSettings, sanitizeSettings } from './meta'

export interface DataPack {
  /** 数据包格式的版本，目前是 1 */
  zbPack: 1
  /** 目标插件的 id */
  plugin: string
  name: string
  version?: string
  description?: string
  author?: string
  /** 设置项的值，必须符合目标插件 meta.settings 的定义 */
  settings: Record<string, unknown>
}

export interface ImportChange {
  key: string
  /** 设置项的显示名称 */
  label: string
  /** list 类型合并，其他类型覆盖 */
  mode: 'merge' | 'replace'
  before: unknown
  after: unknown
  /** 合并时新增的条目 */
  added?: string[]
}

export interface ImportPreview {
  /** 导入之后的全部设置 */
  next: Record<string, unknown>
  /** 有变化的设置项；为空表示导入不会改变任何东西 */
  changes: ImportChange[]
  /** 被忽略的内容（不认识的设置项、不合法的值等） */
  problems: string[]
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_TEXT = 1000
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const optionalText = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= MAX_TEXT)

/** 解析并检查数据包的格式（不检查设置值，见 previewDataPack）。可以传 JSON 字符串或对象。 */
export function parseDataPack(input: unknown): { pack?: DataPack; problems: string[] } {
  let data = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch {
      return { problems: ['不是有效的 JSON 文件'] }
    }
  }
  if (!isRecord(data) || !('zbPack' in data)) return { problems: ['这不是 zhihu-browser 的数据包'] }
  const problems: string[] = []
  if (data.zbPack !== 1) problems.push(`不支持的数据包版本 ${String(data.zbPack)}，请更新扩展`)
  if (typeof data.plugin !== 'string' || !ID_RE.test(data.plugin)) problems.push('plugin 必须是插件的 id')
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100) {
    problems.push('name 不能为空，最长 100 个字符')
  }
  if (!optionalText(data.version) || !optionalText(data.description) || !optionalText(data.author)) {
    problems.push('version、description、author 必须是字符串')
  }
  if (!isRecord(data.settings)) problems.push('settings 必须是对象')
  if (problems.length) return { problems }
  const pack: DataPack = { zbPack: 1, plugin: data.plugin as string, name: data.name as string, settings: {} }
  for (const key of ['version', 'description', 'author'] as const) {
    const value = data[key]
    if (typeof value === 'string') pack[key] = value
  }
  pack.settings = structuredClone(data.settings as Record<string, unknown>)
  return { pack, problems }
}

/**
 * 预览导入的结果：list 类型的设置合并（保留原有顺序，追加没有的条目），其他设置覆盖。
 * 不认识的设置项和不合法的值会被忽略，并写进 problems。
 */
export function previewDataPack(pack: DataPack, meta: PluginMeta, current: Record<string, unknown>): ImportPreview {
  const base = sanitizeSettings(meta, current).values
  if (pack.plugin !== meta.id) {
    return { next: base, changes: [], problems: [`这个数据包是给插件 ${pack.plugin} 的，不是 ${meta.id}`] }
  }
  const next = { ...base }
  const changes: ImportChange[] = []
  const problems: string[] = []
  for (const [key, value] of Object.entries(pack.settings)) {
    const spec = meta.settings?.[key]
    if (!spec) {
      problems.push(`插件没有设置项 ${key}，已忽略`)
      continue
    }
    const problem = checkSettingValue(spec, value)
    if (problem) {
      problems.push(`${spec.label}：${problem}，已忽略`)
      continue
    }
    const before = base[key]
    if (spec.type === 'list') {
      const existing = new Set(before as string[])
      const added = [...new Set(value as string[])].filter(v => !existing.has(v))
      if (!added.length) continue
      const after = [...(before as string[]), ...added]
      next[key] = after
      changes.push({ key, label: spec.label, mode: 'merge', before, after, added })
    } else if (JSON.stringify(value) !== JSON.stringify(before)) {
      next[key] = structuredClone(value)
      changes.push({ key, label: spec.label, mode: 'replace', before, after: value })
    }
  }
  return { next, changes, problems }
}

/** 把插件当前的设置导出成数据包：只包含和默认值不同的设置项。 */
export function createDataPack(
  meta: PluginMeta,
  values: Record<string, unknown>,
  info: { name: string; version?: string; description?: string; author?: string },
): DataPack {
  const defaults = defaultSettings(meta)
  const current = sanitizeSettings(meta, values).values
  const settings: Record<string, unknown> = {}
  for (const key of Object.keys(meta.settings ?? {})) {
    if (JSON.stringify(current[key]) !== JSON.stringify(defaults[key])) settings[key] = current[key]
  }
  return {
    zbPack: 1,
    plugin: meta.id,
    name: info.name,
    version: info.version ?? '1.0.0',
    ...(info.description ? { description: info.description } : {}),
    ...(info.author ? { author: info.author } : {}),
    settings,
  }
}
