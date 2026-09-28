import { createHost, createMemorySettingsBackend, createMemoryStorageBackend, type Platform } from '@zhihu-browser/core'
import type { PluginAPI, PluginMeta, PluginModule } from '@zhihu-browser/sdk'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { connectHostUI, createPageUI, filterItems } from '../src/index'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function plugin(id: string, name: string, entry: (z: PluginAPI) => unknown): PluginModule {
  return {
    meta: { id, name, version: '1.0.0', api: 1 } as PluginMeta,
    default: entry as PluginModule['default'],
  }
}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.replaceChildren()
})

async function setup(options: { platform?: Platform; plugins?: PluginModule[]; paletteKeys?: string } = {}) {
  const ui = createPageUI(document)
  const host = createHost({
    platform: options.platform ?? 'other',
    services: {
      settings: createMemorySettingsBackend(),
      storage: createMemoryStorageBackend(),
      fetch: async () => {
        throw new Error('不访问网络')
      },
      ui,
      addStyle: css => ui.addStyle(css),
      contents: { all: () => [], current: () => undefined },
      log: () => {},
    },
  })
  host.setPage({ type: 'home', url: 'https://www.zhihu.com/', params: {} })
  const openSettings = vi.fn()
  const hostUI = connectHostUI({
    doc: document,
    host,
    ui,
    platform: options.platform ?? 'other',
    paletteKeys: options.paletteKeys,
    openSettings,
  })
  for (const p of options.plugins ?? []) await host.load(p)
  cleanup = () => {
    hostUI.dispose()
    host.dispose()
    ui.dispose()
  }
  return { ui, host, hostUI, openSettings }
}

const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}
const shadow = () => document.getElementById('zb-root')?.shadowRoot
const paletteInput = () => shadow()?.querySelector<HTMLInputElement>('.palette input')
const options = () => [...(shadow()?.querySelectorAll('.palette [role="option"]') ?? [])]
const titles = () => options().map(o => o.querySelector('.title')?.textContent)
const type = (text: string) => {
  const input = paletteInput()
  if (!input) throw new Error('命令面板没有打开')
  input.value = text
  input.dispatchEvent(new Event('input'))
}

function navPlugin(calls: string[]) {
  return plugin('nav', '导航', z => {
    z.registerShortcut('j', () => calls.push('j'), { description: '下一条' })
    z.registerShortcut('g g', () => calls.push('gg'), { description: '回到顶部', when: ['home'] })
    z.registerCommand('top', { title: '回到顶部', keywords: ['top'], run: () => void calls.push('cmd:top') })
    z.registerCommand('collapse', { title: '收起全部回答', run: () => void calls.push('cmd:collapse') })
  })
}

describe('快捷键', () => {
  test('页面上的按键交给插件；输入框里不触发', async () => {
    const calls: string[] = []
    await setup({ plugins: [navPlugin(calls)] })
    const j = press({ key: 'j', code: 'KeyJ' })
    expect(j.defaultPrevented).toBe(true)
    press({ key: 'g', code: 'KeyG' })
    press({ key: 'g', code: 'KeyG' })
    const input = document.createElement('input')
    document.body.append(input)
    const typed = press({ key: 'j', code: 'KeyJ' }, input)
    expect(typed.defaultPrevented).toBe(false)
    expect(calls).toEqual(['j', 'gg'])
    // 与快捷键无关的按键照常交给页面
    expect(press({ key: 'x', code: 'KeyX' }).defaultPrevented).toBe(false)
  })
})

describe('命令面板', () => {
  test('Ctrl+K 打开，列出插件命令和内置命令；输入过滤；上下选择，回车执行', async () => {
    const calls: string[] = []
    const { ui } = await setup({ plugins: [navPlugin(calls)] })
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    expect(ui.hasModal()).toBe(true)
    expect(titles()).toEqual(['回到顶部', '收起全部回答', '查看快捷键', '插件状态与日志', '打开设置页'])
    expect(options()[0]?.querySelector('.source')?.textContent).toBe('导航')
    type('收起')
    expect(titles()).toEqual(['收起全部回答'])
    type('')
    const input = paletteInput() as HTMLInputElement
    press({ key: 'ArrowDown' }, input)
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe('zb-palette-1')
    press({ key: 'Enter' }, input)
    expect(ui.hasModal()).toBe(false)
    expect(calls).toEqual(['cmd:collapse'])
  })

  test('面板开着的时候，按键不会触发插件的快捷键；再按一次 Ctrl+K 或按 Esc 关闭', async () => {
    const calls: string[] = []
    const { ui } = await setup({ plugins: [navPlugin(calls)] })
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    const input = paletteInput() as HTMLInputElement
    press({ key: 'j', code: 'KeyJ' }, input)
    press({ key: 'j', code: 'KeyJ' })
    expect(calls).toEqual([])
    const again = press({ key: 'k', code: 'KeyK', ctrlKey: true }, input)
    expect(again.defaultPrevented).toBe(true)
    expect(ui.hasModal()).toBe(false)
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    press({ key: 'Escape' }, paletteInput() as HTMLInputElement)
    expect(ui.hasModal()).toBe(false)
  })

  test('macOS 上用 ⌘K；可以改键或者不用快捷键', async () => {
    const { ui, hostUI } = await setup({ platform: 'mac' })
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    expect(ui.hasModal()).toBe(false)
    press({ key: 'k', code: 'KeyK', metaKey: true })
    expect(ui.hasModal()).toBe(true)
    press({ key: 'Escape' }, paletteInput() as HTMLInputElement)
    hostUI.setPaletteKeys('alt+p')
    press({ key: 'k', code: 'KeyK', metaKey: true })
    expect(ui.hasModal()).toBe(false)
    press({ key: 'π', code: 'KeyP', altKey: true })
    expect(ui.hasModal()).toBe(true)
    press({ key: 'Escape' }, paletteInput() as HTMLInputElement)
    hostUI.setPaletteKeys('')
    press({ key: 'π', code: 'KeyP', altKey: true })
    expect(ui.hasModal()).toBe(false)
  })

  test('快捷键写法不对时改用默认的', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ui, host } = await setup({ paletteKeys: 'hyper+x' })
    expect(host.shortcuts().map(s => s.keys)).toEqual(['mod+k'])
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    expect(ui.hasModal()).toBe(true)
    warn.mockRestore()
  })

  test('内置命令：打开设置页', async () => {
    const { hostUI, openSettings } = await setup()
    hostUI.openPalette()
    type('设置')
    press({ key: 'Enter' }, paletteInput() as HTMLInputElement)
    expect(openSettings).toHaveBeenCalledTimes(1)
  })

  test('filterItems：每个词都要匹配；标题开头匹配的排前面', () => {
    const items = [
      { id: '1', title: '显示全部', keywords: ['阅读'], run() {} },
      { id: '2', title: '阅读模式', run() {} },
      { id: '3', title: '打开阅读模式设置', source: '阅读', run() {} },
    ]
    expect(filterItems(items, '阅读').map(i => i.id)).toEqual(['2', '3', '1'])
    expect(filterItems(items, '阅读 设置').map(i => i.id)).toEqual(['3'])
    expect(filterItems(items, '  ').map(i => i.id)).toEqual(['1', '2', '3'])
  })
})

describe('面板', () => {
  test('快捷键一览：按来源分组，标出冲突', async () => {
    await setup({
      plugins: [
        navPlugin([]),
        plugin('other', '另一个', z => void z.registerShortcut('j', () => {}, { description: '也用 j' })),
      ],
    })
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    type('快捷键')
    press({ key: 'Enter' }, paletteInput() as HTMLInputElement)
    const sheet = shadow()?.querySelector('.sheet')
    expect(sheet?.querySelector('h2')?.textContent).toBe('快捷键')
    expect([...(sheet?.querySelectorAll('h3') ?? [])].map(h => h.textContent)).toEqual([
      'zhihu-browser',
      '导航',
      '另一个',
    ])
    expect([...(sheet?.querySelectorAll('kbd') ?? [])].map(k => k.textContent)).toEqual(['Ctrl+K', 'J', 'G G', 'J'])
    expect(sheet?.textContent).toContain('只在首页生效')
    expect(sheet?.querySelector('.note.warn')?.textContent).toBe('和"导航"的快捷键冲突，没有生效')
  })

  test('插件状态与日志：出错停用的插件可以重新启用', async () => {
    let fail = true
    const { ui, host } = await setup({
      plugins: [
        plugin('ok', '正常', z => z.log.info('启动了')),
        plugin('bad', '出错', z => {
          z.log.warn('准备出错')
          if (fail) throw new Error('坏了')
        }),
      ],
    })
    const toast = shadow()?.querySelector('.toast')?.textContent
    expect(toast).toContain('插件"出错"出错，已在这个页面停用')

    const panel = () => shadow()?.querySelector('.sheet')
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    type('日志')
    press({ key: 'Enter' }, paletteInput() as HTMLInputElement)
    const rows = () => [...(panel()?.querySelectorAll('.row') ?? [])]
    expect(rows().map(r => r.querySelector('.state')?.textContent)).toEqual(['运行中', '出错停用'])
    expect(rows()[0]?.querySelector('.logs')?.textContent).toMatch(/\d\d:\d\d:\d\d info 启动了/)
    expect(rows()[1]?.textContent).toContain('启动时出错：Error: 坏了')
    expect(rows()[1]?.querySelector('[data-level="error"]')).not.toBeNull()

    fail = false
    rows()[1]?.querySelector<HTMLButtonElement>('button')?.click()
    await flush()
    expect(host.plugin('bad')?.state).toBe('active')
    expect(rows()[1]?.querySelector('.state')?.textContent).toBe('运行中')
    expect(ui.hasModal()).toBe(true)
    // 面板开着的时候插件状态变了（例如在设置页停用）：跟着更新
    host.disable('ok')
    expect(rows()[0]?.querySelector('.state')?.textContent).toBe('没有运行')
    expect(rows()[0]?.textContent).toContain('已停用')
  })
})
