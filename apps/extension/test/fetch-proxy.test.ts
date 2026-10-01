import { describe, expect, test, vi } from 'vitest'
import { type FetchProxyDeps, MAX_RESPONSE_BYTES, proxyFetch } from '../src/user-plugins/fetch-proxy'
import type { UserPluginEntry, UserPluginIndex } from '../src/user-plugins/store'

const entry = (overrides: Partial<UserPluginEntry> = {}, permissions = ['net:api.example.com']): UserPluginEntry => ({
  meta: { id: 'p', name: 'p', version: '1.0.0', api: 1, permissions: permissions as never },
  secret: 'x'.repeat(32),
  enabled: true,
  installedAt: 0,
  updatedAt: 0,
  rev: 1,
  ...overrides,
})

function deps(options: {
  entry?: UserPluginEntry | undefined
  granted?: boolean
  response?: Response
  finalUrl?: string
}): FetchProxyDeps & { fetch: ReturnType<typeof vi.fn> } {
  const response =
    options.response ??
    new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'x-a': '1' } })
  if (options.finalUrl) Object.defineProperty(response, 'url', { value: options.finalUrl })
  return {
    index: async (): Promise<UserPluginIndex> => (options.entry ? { p: options.entry } : {}),
    hasPermission: async () => options.granted ?? true,
    fetch: vi.fn(async () => response),
  }
}

describe('proxyFetch', () => {
  test('按声明的域名放行，返回状态、头和正文', async () => {
    const d = deps({ entry: entry() })
    const reply = await proxyFetch(d, { pluginId: 'p', url: 'https://api.example.com/x?q=1' })
    expect(reply).toMatchObject({ status: 200, ok: true, text: '{"ok":true}' })
    expect(reply.headers['x-a']).toBe('1')
    const [url, init] = d.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/x?q=1')
    // 不带 Cookie，不带来源页面
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
  })

  test('POST 带正文，GET 不带', async () => {
    const d = deps({ entry: entry() })
    await proxyFetch(d, { pluginId: 'p', url: 'https://api.example.com/', init: { method: 'post', body: 'a=1' } })
    expect(d.fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: 'a=1' })
    const d2 = deps({ entry: entry() })
    await proxyFetch(d2, { pluginId: 'p', url: 'https://api.example.com/', init: { body: 'a=1' } })
    expect(d2.fetch.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })

  test.each([
    ['没有安装的插件', { entry: undefined }, '只有已安装的用户插件'],
    ['已停用的插件', { entry: entry({ enabled: false }) }, '已停用'],
    ['没有授予浏览器权限', { entry: entry(), granted: false }, '没有授予'],
  ])('%s被拒绝', async (_name, options, message) => {
    const d = deps(options)
    await expect(proxyFetch(d, { pluginId: 'p', url: 'https://api.example.com/' })).rejects.toThrow(message)
    expect(d.fetch).not.toHaveBeenCalled()
  })

  test('没有声明的域名、知乎的域名、非 http 协议被拒绝', async () => {
    const d = deps({ entry: entry() })
    await expect(proxyFetch(d, { pluginId: 'p', url: 'https://evil.com/' })).rejects.toThrow('没有声明')
    await expect(proxyFetch(d, { pluginId: 'p', url: 'https://www.zhihu.com/api' })).rejects.toThrow('知乎')
    await expect(proxyFetch(d, { pluginId: 'p', url: 'file:///etc/passwd' })).rejects.toThrow('http')
    expect(d.fetch).not.toHaveBeenCalled()
  })

  test('重定向到没有声明的域名时丢弃响应', async () => {
    const d = deps({ entry: entry(), finalUrl: 'https://evil.com/steal' })
    await expect(proxyFetch(d, { pluginId: 'p', url: 'https://api.example.com/' })).rejects.toThrow('重定向')
  })

  test('重定向到另一个声明过的域名是允许的', async () => {
    const d = deps({ entry: entry({}, ['net:api.example.com', 'net:*.cdn.com']), finalUrl: 'https://a.cdn.com/f' })
    await expect(proxyFetch(d, { pluginId: 'p', url: 'https://api.example.com/' })).resolves.toMatchObject({ ok: true })
  })

  test('响应太大时拒绝（先看 content-length，再看实际大小）', async () => {
    const big = new Response('x', { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } })
    await expect(
      proxyFetch(deps({ entry: entry(), response: big }), { pluginId: 'p', url: 'https://api.example.com/' }),
    ).rejects.toThrow('超过')
    const actual = new Response(new Uint8Array(MAX_RESPONSE_BYTES + 1))
    await expect(
      proxyFetch(deps({ entry: entry(), response: actual }), { pluginId: 'p', url: 'https://api.example.com/' }),
    ).rejects.toThrow('超过')
  })

  test('非 2xx 的响应照常返回，ok 为 false', async () => {
    const d = deps({ entry: entry(), response: new Response('no', { status: 404 }) })
    expect(await proxyFetch(d, { pluginId: 'p', url: 'https://api.example.com/' })).toMatchObject({
      status: 404,
      ok: false,
      text: 'no',
    })
  })
})
