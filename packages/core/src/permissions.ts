import type { PluginMeta } from '@zhihu-browser/sdk'

const HOST_RE = /^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

/** 权限写法是否正确：net:域名，或 net:*.域名。 */
export function validPermission(permission: string): boolean {
  if (!permission.startsWith('net:')) return false
  const host = permission.slice(4)
  return HOST_RE.test(host) && !isZhihuHost(host.replace(/^\*\./, ''))
}

export function isZhihuHost(hostname: string): boolean {
  return hostname === 'zhihu.com' || hostname.endsWith('.zhihu.com')
}

/**
 * 域名是否匹配权限里的写法。与浏览器的主机权限一致：
 * '*.example.com' 匹配 example.com 本身及其所有子域名。
 */
export function hostMatches(pattern: string, hostname: string): boolean {
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2)
    return hostname === base || hostname.endsWith(`.${base}`)
  }
  return hostname === pattern
}

/** 检查 z.fetch 的地址，不允许时抛出错误。 */
export function checkFetchUrl(meta: PluginMeta, url: string): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new TypeError(`z.fetch 需要完整的网址（以 https:// 开头），收到的是：${url}`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new TypeError(`z.fetch 只支持 http 和 https：${url}`)
  if (isZhihuHost(u.hostname)) {
    throw new Error('z.fetch 不能访问知乎自己的域名；插件需要的知乎数据，请通过过滤函数和渲染钩子获得')
  }
  const allowed = (meta.permissions ?? []).map(p => p.slice(4))
  if (!allowed.some(pattern => hostMatches(pattern, u.hostname))) {
    throw new Error(`没有声明访问 ${u.hostname} 的权限，请在 meta.permissions 里加上 'net:${u.hostname}'`)
  }
  return u
}
