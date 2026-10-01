// z.fetch 的网络代理（在后台运行）。
//
// 用户插件调用 z.fetch 后，请求经内容脚本发到这里。后台按插件安装时确认过的 meta.permissions 放行：
// 只能访问声明过的域名，不能访问知乎自己的域名，不携带 Cookie，也不带来源页面。
// 浏览器的主机权限（optional_host_permissions）在安装时由用户授予，没有授予时请求直接失败。

import { checkFetchUrl, hostMatches, isZhihuHost } from '@zhihu-browser/core'
import type { FetchInit } from '@zhihu-browser/sdk'
import type { UserPluginIndex } from './store'

/** 响应正文的大小上限 */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

export interface FetchRequest {
  pluginId: string
  url: string
  init?: FetchInit
}

export interface FetchReply {
  status: number
  ok: boolean
  headers: Record<string, string>
  text: string
}

export interface FetchProxyDeps {
  index(): Promise<UserPluginIndex>
  /** 浏览器是否已经授予这些主机权限 */
  hasPermission(patterns: string[]): Promise<boolean>
  fetch: typeof fetch
}

const MAX_TIMEOUT = 120_000
const DEFAULT_TIMEOUT = 30_000

export async function proxyFetch(deps: FetchProxyDeps, request: FetchRequest): Promise<FetchReply> {
  const entry = (await deps.index())[String(request.pluginId)]
  if (!entry) throw new Error('只有已安装的用户插件可以使用 z.fetch')
  if (!entry.enabled) throw new Error(`插件 ${entry.meta.id} 已停用`)
  const url = checkFetchUrl(entry.meta, String(request.url))
  if (!(await deps.hasPermission([`*://${url.hostname}/*`]))) {
    throw new Error(`浏览器还没有授予访问 ${url.hostname} 的权限，请在设置页的"用户插件"里授权`)
  }

  const init = request.init ?? {}
  const timeout = Math.min(Math.max(Number(init.timeout) || DEFAULT_TIMEOUT, 1), MAX_TIMEOUT)
  const method = (init.method ?? 'GET').toUpperCase()
  const response = await deps.fetch(url.href, {
    method,
    headers: init.headers ?? {},
    ...(init.body !== undefined && method !== 'GET' && method !== 'HEAD' ? { body: String(init.body) } : {}),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeout),
  })

  // 重定向之后的地址也必须是声明过的域名
  if (response.url) {
    const finalHost = new URL(response.url).hostname
    const allowed = (entry.meta.permissions ?? []).map(p => p.slice('net:'.length))
    if (isZhihuHost(finalHost) || !allowed.some(pattern => hostMatches(pattern, finalHost))) {
      throw new Error(`请求被重定向到没有声明的域名 ${finalHost}`)
    }
  }

  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_RESPONSE_BYTES) throw new Error(`响应超过 ${MAX_RESPONSE_BYTES / 1024 / 1024} MB`)
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error(`响应超过 ${MAX_RESPONSE_BYTES / 1024 / 1024} MB`)

  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  return { status: response.status, ok: response.ok, headers, text: new TextDecoder().decode(buffer) }
}

/** 内容脚本与后台之间的消息 */
export const FETCH_MESSAGE = 'plugin-fetch'
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string }
