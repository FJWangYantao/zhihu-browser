// 读取知乎数据时用到的小工具。知乎的数据结构随时可能变化，读取时一律先检查类型。

export type Obj = Record<string, unknown>

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 字符串或有限数字转成字符串（知乎的 id 有时是数字） */
export function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return undefined
}

export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** 按顺序取第一个不为空的字段（用于同时兼容 snake_case 和 camelCase） */
export function pick(o: Obj, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = o[key]
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

/** 知乎的时间是秒，统一换成毫秒 */
export function time(v: unknown): number | undefined {
  const n = num(v)
  if (n === undefined || n <= 0) return undefined
  return n < 1e12 ? n * 1000 : n
}

/** 去掉值为 undefined 的字段 */
export function compact<T extends object>(o: T): T {
  for (const key of Object.keys(o) as (keyof T)[]) if (o[key] === undefined) delete o[key]
  return o
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

/** 去掉网址里的 # 部分，用来判断是否换了页面 */
export const withoutHash = (url: string) => url.split('#')[0] ?? url
