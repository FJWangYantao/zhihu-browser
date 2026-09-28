import type { PluginMeta, SettingSpec } from '@zhihu-browser/sdk'
import { validPermission } from './permissions'

/** 宿主支持的插件 API 大版本。 */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1]

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SETTING_TYPES = new Set(['boolean', 'number', 'string', 'text', 'select', 'list', 'color'])

export class PluginLoadError extends Error {
  readonly pluginId: string | undefined
  readonly problems: string[]

  constructor(pluginId: string | undefined, problems: string[]) {
    super(`插件 ${pluginId ?? '（未知）'} 无法加载：${problems.join('；')}`)
    this.name = 'PluginLoadError'
    this.pluginId = pluginId
    this.problems = problems
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 检查插件的 meta，返回发现的问题；没有问题时返回空数组。 */
export function validateMeta(meta: unknown): string[] {
  if (!isRecord(meta)) return ['meta 必须是对象']
  const problems: string[] = []
  const { id, name, version, api, permissions, settings } = meta

  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 64) {
    problems.push('id 只能包含小写字母、数字和连字符，最长 64 个字符')
  }
  if (typeof name !== 'string' || !name.trim()) problems.push('name 不能为空')
  if (typeof version !== 'string' || !VERSION_RE.test(version)) problems.push('version 必须是语义化版本号，如 1.0.0')
  if (typeof api !== 'number' || !SUPPORTED_API_VERSIONS.includes(api)) {
    problems.push(`api 版本 ${String(api)} 不受支持（支持：${SUPPORTED_API_VERSIONS.join('、')}）`)
  }
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) problems.push('permissions 必须是数组')
    else
      for (const p of permissions) {
        if (typeof p !== 'string' || !validPermission(p)) problems.push(`权限 ${String(p)} 的写法不对，应为 net:域名`)
      }
  }
  if (settings !== undefined) {
    if (!isRecord(settings)) problems.push('settings 必须是对象')
    else
      for (const [key, spec] of Object.entries(settings)) {
        const problem = checkSettingSpec(spec)
        if (problem) problems.push(`设置项 ${key}：${problem}`)
      }
  }
  return problems
}

function checkSettingSpec(spec: unknown): string | null {
  if (!isRecord(spec)) return '必须是对象'
  if (typeof spec.type !== 'string' || !SETTING_TYPES.has(spec.type)) return `不支持的类型 ${String(spec.type)}`
  if (typeof spec.label !== 'string' || !spec.label.trim()) return 'label 不能为空'
  if (spec.type === 'select') {
    if (!isRecord(spec.options) || Object.keys(spec.options).length === 0) return 'select 需要非空的 options'
    if (!Object.values(spec.options).every(v => typeof v === 'string')) return 'options 的显示文字必须是字符串'
  }
  return checkSettingValue(spec as SettingSpec, spec.default, '默认值')
}

/** 检查一个设置值是否符合定义；符合时返回 null，否则返回问题描述。 */
export function checkSettingValue(spec: SettingSpec, value: unknown, what = '值'): string | null {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : `${what}必须是布尔值`
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${what}必须是数字`
      if (spec.min !== undefined && value < spec.min) return `${what}不能小于 ${spec.min}`
      if (spec.max !== undefined && value > spec.max) return `${what}不能大于 ${spec.max}`
      return null
    case 'select':
      return typeof value === 'string' && Object.hasOwn(spec.options, value)
        ? null
        : `${what}必须是 ${Object.keys(spec.options).join('、')} 之一`
    case 'list':
      return Array.isArray(value) && value.every(v => typeof v === 'string') ? null : `${what}必须是字符串数组`
    default:
      return typeof value === 'string' ? null : `${what}必须是字符串`
  }
}

/** 设置的默认值。 */
export function defaultSettings(meta: PluginMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(meta.settings ?? {})) out[key] = structuredClone(spec.default)
  return out
}

/** 用定义校验保存下来的设置：未知的键丢弃，不合法的值换成默认值。 */
export function sanitizeSettings(
  meta: PluginMeta,
  stored: Record<string, unknown>,
): { values: Record<string, unknown>; invalid: string[] } {
  const values = defaultSettings(meta)
  const invalid: string[] = []
  for (const [key, spec] of Object.entries(meta.settings ?? {})) {
    if (!Object.hasOwn(stored, key)) continue
    const value = stored[key]
    if (checkSettingValue(spec, value) === null) values[key] = structuredClone(value)
    else invalid.push(key)
  }
  return { values, invalid }
}
