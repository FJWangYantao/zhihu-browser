// 安装、更新插件时展示给用户确认的内容。

import type { PluginMeta } from '@zhihu-browser/sdk'

/** 插件声明的外部域名（meta.permissions 里 net: 开头的） */
export function networkHosts(meta: PluginMeta): string[] {
  return (meta.permissions ?? []).map(p => p.slice('net:'.length)).sort()
}

export interface PermissionChange {
  added: string[]
  removed: string[]
}

/** 更新插件时比较权限变化：新增的权限需要用户重新确认 */
export function diffPermissions(before: PluginMeta | undefined, after: PluginMeta): PermissionChange {
  const old = new Set(before ? networkHosts(before) : [])
  const next = new Set(networkHosts(after))
  return {
    added: [...next].filter(h => !old.has(h)),
    removed: [...old].filter(h => !next.has(h)),
  }
}

/** 浏览器的主机权限写法：'*.example.com' → '*://*.example.com/*'，'api.example.com' → '*://api.example.com/*' */
export function hostPermissionPattern(host: string): string {
  return `*://${host}/*`
}

/** 比较版本号（只比较 x.y.z，预发布版本视为比同号的正式版小）：a 比 b 新返回正数 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre] = v.split('-', 2)
    return { nums: core.split('.').map(n => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return d
  }
  if (x.pre === y.pre) return 0
  if (x.pre === undefined) return 1
  if (y.pre === undefined) return -1
  return x.pre < y.pre ? -1 : 1
}
