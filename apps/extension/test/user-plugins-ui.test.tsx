import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PluginClient } from '../entrypoints/options/client'
import { InstallPanel, UserPluginFooter, UserScriptsGuide } from '../entrypoints/options/user-plugins'
import type { PlanView } from '../src/user-plugins/manager'
import type { UserPluginEntry } from '../src/user-plugins/store'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

let root: HTMLElement
beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
})
afterEach(() => {
  render(null, root)
  root.remove()
})
const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)
const text = () => root.textContent ?? ''
const button = (label: string) =>
  [...root.querySelectorAll('button')].find(b => b.textContent?.includes(label)) as HTMLButtonElement | undefined

async function click(label: string) {
  const b = button(label)
  if (!b) throw new Error(`找不到按钮：${label}`)
  await act(async () => {
    b.click()
    await flush()
  })
}

async function type(el: HTMLTextAreaElement | HTMLInputElement | null, value: string) {
  if (!el) throw new Error('找不到输入框')
  await act(async () => {
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
  })
}

const plan = (overrides: Partial<PlanView> = {}): PlanView => ({
  meta: { id: 'my-plugin', name: '我的插件', version: '1.0.0', api: 1, author: '某人', description: '做点什么' },
  action: 'install',
  permissions: { added: [], removed: [] },
  hosts: [],
  hostPatterns: [],
  ...overrides,
})

function fakeClient(overrides: Partial<PluginClient> = {}) {
  const calls: unknown[] = []
  const client: PluginClient = {
    manage: (async (request: { op: string }) => {
      calls.push(request)
      if (request.op === 'plan') return { ok: true, value: plan() }
      if (request.op === 'install') return { ok: true, value: { entry: {}, plan: plan(), scriptsAvailable: true } }
      return { ok: true, value: null }
    }) as PluginClient['manage'],
    requestHosts: vi.fn(async () => true),
    hasHosts: vi.fn(async () => true),
    removeHosts: vi.fn(async () => {}),
    fetchSource: vi.fn(async () => ({ source: 'downloaded', fileName: 'x.ts' })),
    openExtensionDetails: vi.fn(),
    detailsUrl: 'chrome://extensions/?id=abc',
    ...overrides,
  }
  return { client, calls }
}

describe('引导', () => {
  test('用户脚本可用或还没检查时不显示', () => {
    const { client } = fakeClient()
    render(<UserScriptsGuide client={client} available={true} />, root)
    expect(text()).toBe('')
    render(<UserScriptsGuide client={client} available={undefined} />, root)
    expect(text()).toBe('')
  })

  test('不可用时给出步骤，可以打开扩展详情页', async () => {
    const { client } = fakeClient()
    render(<UserScriptsGuide client={client} available={false} />, root)
    expect(text()).toContain('允许用户脚本')
    expect(text()).toContain('chrome://extensions/?id=abc')
    await click('打开 zhihu-browser 的扩展详情页')
    expect(client.openExtensionDetails).toHaveBeenCalled()
  })
})

describe('安装', () => {
  test('检查 → 确认页面显示信息和源码 → 确认后安装', async () => {
    const { client, calls } = fakeClient()
    const onInstalled = vi.fn()
    render(<InstallPanel client={client} onInstalled={onInstalled} />, root)
    await type($('#plugin-source'), 'export const meta = {}')
    await click('检查并安装')
    expect(calls).toEqual([{ op: 'plan', source: 'export const meta = {}' }])
    expect(text()).toContain('安装「我的插件」')
    expect(text()).toContain('作者：某人')
    expect(text()).toContain('不访问任何外部网络')
    expect(text()).toContain('以你的身份操作页面')
    expect($('pre.source')?.textContent).toBe('export const meta = {}')
    // 确认之前没有安装
    expect(calls.some(c => (c as { op: string }).op === 'install')).toBe(false)

    await click('确认安装')
    expect(calls.at(-1)).toEqual({ op: 'install', source: 'export const meta = {}' })
    expect(onInstalled).toHaveBeenCalledWith({ name: '我的插件', action: '安装', scriptsAvailable: true })
    expect($('pre.source')).toBeNull()
    expect(($('#plugin-source') as HTMLTextAreaElement).value).toBe('')
  })

  test('取消不会安装', async () => {
    const { client, calls } = fakeClient()
    render(<InstallPanel client={client} onInstalled={() => {}} />, root)
    await type($('#plugin-source'), 'x')
    await click('检查并安装')
    await click('取消')
    expect($('.review')).toBeNull()
    expect(calls.some(c => (c as { op: string }).op === 'install')).toBe(false)
  })

  test('需要外部域名时列出，并在确认时请求授权；更新时标出新增的', async () => {
    const withHosts = plan({
      action: 'update',
      existing: { meta: { id: 'my-plugin', name: '我的插件', version: '0.9.0', api: 1 } } as UserPluginEntry,
      hosts: ['api.example.com', 'b.example.com'],
      hostPatterns: ['*://api.example.com/*', '*://b.example.com/*'],
      permissions: { added: ['b.example.com'], removed: [] },
    })
    const { client } = fakeClient({
      manage: (async (request: { op: string }) =>
        request.op === 'plan'
          ? { ok: true, value: withHosts }
          : { ok: true, value: { entry: {}, plan: withHosts, scriptsAvailable: true } }) as PluginClient['manage'],
    })
    render(<InstallPanel client={client} onInstalled={() => {}} />, root)
    await type($('#plugin-source'), 'x')
    await click('检查并安装')
    expect(text()).toContain('更新「我的插件」')
    expect(text()).toContain('0.9.0 → 1.0.0')
    expect(text()).toContain('api.example.com')
    expect($('.review .new')?.previousElementSibling?.textContent).toBe('b.example.com')
    await click('确认更新')
    expect(client.requestHosts).toHaveBeenCalledWith(['*://api.example.com/*', '*://b.example.com/*'])
  })

  test('没有授予权限时仍然安装，并提示', async () => {
    const withHosts = plan({ hosts: ['a.com'], hostPatterns: ['*://a.com/*'] })
    const { client } = fakeClient({
      requestHosts: vi.fn(async () => false),
      manage: (async (request: { op: string }) =>
        request.op === 'plan'
          ? { ok: true, value: withHosts }
          : { ok: true, value: { entry: {}, plan: withHosts, scriptsAvailable: true } }) as PluginClient['manage'],
    })
    const onInstalled = vi.fn()
    render(<InstallPanel client={client} onInstalled={onInstalled} />, root)
    await type($('#plugin-source'), 'x')
    await click('检查并安装')
    await click('确认安装')
    expect(onInstalled).toHaveBeenCalled()
    expect(text()).toContain('没有授予访问外部网站的权限')
  })

  test('代码不合法时显示原因，不进入确认', async () => {
    const { client } = fakeClient({
      manage: (async () => ({ ok: false, error: 'x', problems: ['缺少默认导出', 'meta：id 不对'] })) as never,
    })
    render(<InstallPanel client={client} onInstalled={() => {}} />, root)
    await type($('#plugin-source'), 'bad')
    await click('检查并安装')
    expect($('[role="alert"]')?.textContent).toContain('缺少默认导出')
    expect($('[role="alert"]')?.textContent).toContain('meta：id 不对')
    expect($('.review')).toBeNull()
  })

  test('没有输入时提示', async () => {
    const { client, calls } = fakeClient()
    render(<InstallPanel client={client} onInstalled={() => {}} />, root)
    await click('检查并安装')
    expect(text()).toContain('请先粘贴插件代码')
    expect(calls).toEqual([])
  })

  test('从链接下载后直接进入确认', async () => {
    const { client, calls } = fakeClient()
    render(<InstallPanel client={client} onInstalled={() => {}} />, root)
    await type($('#plugin-url'), 'https://example.com/x.ts')
    await click('下载并检查')
    expect(client.fetchSource).toHaveBeenCalledWith('https://example.com/x.ts')
    expect(calls).toEqual([{ op: 'plan', source: 'downloaded', fileName: 'x.ts' }])
    expect(text()).toContain('安装「我的插件」')
  })

  test('下载失败时显示原因', async () => {
    const { client } = fakeClient({
      fetchSource: vi.fn(async () => {
        throw new Error('下载失败：HTTP 404')
      }),
    })
    render(<InstallPanel client={client} onInstalled={() => {}} />, root)
    await type($('#plugin-url'), 'https://example.com/x.ts')
    await click('下载并检查')
    expect(text()).toContain('HTTP 404')
  })

  test('"编辑源码"把源码放进编辑框', async () => {
    const { client, calls } = fakeClient()
    const handle: { current: import('../entrypoints/options/user-plugins').InstallPanelHandle | null } = {
      current: null,
    }
    await act(async () => {
      render(<InstallPanel client={client} handle={handle} onInstalled={() => {}} />, root)
      await flush()
    })
    await act(async () => {
      handle.current?.edit('旧源码', 'old.ts')
      await flush()
    })
    expect(($('#plugin-source') as HTMLTextAreaElement).value).toBe('旧源码')
    await click('检查并安装')
    expect(calls).toEqual([{ op: 'plan', source: '旧源码', fileName: 'old.ts' }])
  })
})

describe('已安装插件的操作', () => {
  const entry = (permissions: string[] = []): UserPluginEntry => ({
    meta: { id: 'my-plugin', name: '我的插件', version: '1.0.0', api: 1, author: '某人', permissions } as never,
    secret: 'x'.repeat(32),
    enabled: true,
    installedAt: 0,
    updatedAt: 0,
    rev: 1,
  })

  test('卸载要二次确认', async () => {
    const { client } = fakeClient()
    const onUninstall = vi.fn()
    render(
      <UserPluginFooter
        client={client}
        entry={entry()}
        onEdit={() => {}}
        onUninstall={onUninstall}
        onSaved={() => {}}
      />,
      root,
    )
    await click('卸载')
    expect(onUninstall).not.toHaveBeenCalled()
    expect(text()).toContain('同时删除这个插件的设置和数据')
    await click('确认卸载')
    expect(onUninstall).toHaveBeenCalledTimes(1)
  })

  test('还没有授权域名时显示并可以授权', async () => {
    const { client } = fakeClient({ hasHosts: vi.fn(async () => false) })
    const onSaved = vi.fn()
    await act(async () => {
      render(
        <UserPluginFooter
          client={client}
          entry={entry(['net:api.example.com'])}
          onEdit={() => {}}
          onUninstall={() => {}}
          onSaved={onSaved}
        />,
        root,
      )
      await flush()
    })
    expect(text()).toContain('api.example.com')
    // 检查权限在 useEffect 里进行，preact 的 effect 在下一帧才执行
    await vi.waitFor(() => expect(button('授权')).toBeDefined())
    expect(text()).toContain('尚未授权')
    await click('授权')
    expect(client.requestHosts).toHaveBeenCalledWith(['*://api.example.com/*'])
    expect(onSaved).toHaveBeenCalledWith('已授权')
    expect(text()).toContain('已授权')
  })
})
