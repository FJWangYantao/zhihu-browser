import type { PluginMeta } from '@zhihu-browser/sdk'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { exportPack, PackImport } from '../entrypoints/options/packs'
import { parseKeys, ShortcutSettings } from '../entrypoints/options/shortcuts'
import type { Registry } from '../src/storage'
import { fakeStorage } from './fake-storage'

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

/** 模拟用户改完输入框的内容（change 事件在失去焦点时触发） */
async function changeInput(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('找不到输入框')
  await act(async () => {
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  })
}

describe('快捷键设置', () => {
  const registry: Registry = {
    platform: 'other',
    shortcuts: [
      { id: '@host:mod+k', keys: 'mod+k', defaultKeys: 'mod+k', pluginId: '@host', description: '打开命令面板' },
      { id: 'nav:j', keys: 'j', defaultKeys: 'j', pluginId: 'nav', description: '下一条' },
      {
        id: 'nav:mod+k',
        keys: 'mod+k',
        defaultKeys: 'mod+k',
        pluginId: 'nav',
        description: '搜索',
        conflictWith: '@host',
      },
    ],
  }

  function show(props: Partial<Parameters<typeof ShortcutSettings>[0]> = {}) {
    const storage = fakeStorage()
    const saved = vi.fn()
    render(
      <ShortcutSettings
        api={storage.api}
        platform="other"
        keymap={{}}
        registry={registry}
        pluginName={id => (id === 'nav' ? '导航' : id)}
        onSaved={saved}
        {...props}
      />,
      root,
    )
    return { ...storage, saved }
  }

  test('列出插件的快捷键（不含命令面板本身），标出冲突', () => {
    show()
    expect([...root.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['导航'])
    expect([...root.querySelectorAll('label')].map(l => l.textContent)).toEqual(['打开命令面板', '下一条', '搜索'])
    expect($<HTMLInputElement>('#palette-keys')?.value).toBe('mod+k')
    expect([...root.querySelectorAll('kbd')].map(k => k.textContent)).toEqual(['Ctrl+K', 'J', 'Ctrl+K'])
    expect(text()).toContain('和"命令面板"的快捷键冲突，没有生效')
  })

  test('改键、停用、写法不对时不保存', async () => {
    const { data, saved } = show()
    await changeInput($('[id="shortcut-nav:j"]'), 'Shift+N')
    expect(data.get('keymap')).toEqual({ 'nav:j': 'shift+n' })
    await changeInput($('[id="shortcut-nav:j"]'), '  ')
    expect(data.get('keymap')).toEqual({ 'nav:j': '' })
    expect(saved).toHaveBeenLastCalledWith('已停用这个快捷键')
    await changeInput($('[id="shortcut-nav:j"]'), 'hyper+x')
    expect(text()).toContain('不认识的修饰键')
    expect(data.get('keymap')).toEqual({ 'nav:j': '' })
  })

  test('改回默认的写法、点"恢复默认"时删掉改键记录', async () => {
    const { data } = show({ keymap: { 'nav:j': 'n' } })
    expect($<HTMLInputElement>('[id="shortcut-nav:j"]')?.value).toBe('n')
    await act(async () => {
      root.querySelector<HTMLButtonElement>('button.link')?.click()
      await flush()
    })
    expect(data.get('keymap')).toEqual({})
  })

  test('命令面板的快捷键', async () => {
    const { data } = show({ paletteKeys: 'alt+p' })
    expect($<HTMLInputElement>('#palette-keys')?.value).toBe('alt+p')
    await changeInput($('#palette-keys'), 'ctrl+shift+p')
    expect(data.get('paletteKeys')).toBe('ctrl+shift+p')
    await changeInput($('#palette-keys'), '')
    expect(data.get('paletteKeys')).toBe('')
  })

  test('还没打开过知乎页面时给出提示', () => {
    show({ registry: undefined })
    expect(text()).toContain('打开一次知乎页面后')
  })

  test('parseKeys', () => {
    expect(parseKeys(' G  G ')).toEqual({ keys: 'g g' })
    expect(parseKeys('')).toEqual({ keys: '' })
    expect('error' in parseKeys('shift+')).toBe(true)
  })
})

describe('数据包', () => {
  const meta = {
    id: 'filter',
    name: '屏蔽',
    version: '1.0.0',
    api: 1,
    settings: {
      keywords: { type: 'list', label: '屏蔽关键词', default: [] },
      mode: { type: 'select', label: '屏蔽方式', default: 'fold', options: { fold: '折叠', remove: '直接去掉' } },
    },
  } satisfies PluginMeta

  function show(settings: Record<string, unknown> = { keywords: ['旧'], mode: 'fold' }) {
    const storage = fakeStorage()
    const saved = vi.fn()
    render(<PackImport api={storage.api} plugins={[{ meta }]} settings={{ filter: settings }} onSaved={saved} />, root)
    return { ...storage, saved }
  }

  async function choose(content: string) {
    const input = $<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('找不到文件选择框')
    const file = new File([content], 'pack.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await flush()
      await flush()
    })
  }

  const pack = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ zbPack: 1, plugin: 'filter', name: '一份列表', description: '示例', settings, ...extra })

  test('先预览会改动哪些设置，确认后才导入', async () => {
    const { data, saved } = show()
    await choose(pack({ keywords: ['旧', '新一', '新二'], mode: 'remove', unknown: 1 }))
    const preview = $('section.pack-preview')
    expect(preview?.querySelector('h3')?.textContent).toBe('一份列表')
    expect([...(preview?.querySelectorAll('.changes li') ?? [])].map(li => li.textContent)).toEqual([
      '屏蔽关键词：新增 2 项：新一、新二',
      '屏蔽方式：折叠 → 直接去掉',
    ])
    expect(preview?.querySelector('.problems')?.textContent).toContain('插件没有设置项 unknown')
    expect(data.size).toBe(0)
    await act(async () => {
      preview?.querySelector<HTMLButtonElement>('button.primary')?.click()
      await flush()
    })
    expect(data.get('settings:filter')).toEqual({ keywords: ['旧', '新一', '新二'], mode: 'remove' })
    expect(saved).toHaveBeenCalledWith('已导入"一份列表"')
    expect($('section.pack-preview')).toBeNull()
  })

  test('没有变化时不能导入；可以取消', async () => {
    show()
    await choose(pack({ keywords: ['旧'] }))
    expect(text()).toContain('导入后不会改变任何设置')
    expect($<HTMLButtonElement>('section.pack-preview button.primary')?.disabled).toBe(true)
    await act(async () => {
      root.querySelectorAll<HTMLButtonElement>('section.pack-preview button')[1]?.click()
      await flush()
    })
    expect($('section.pack-preview')).toBeNull()
  })

  test('文件不对、插件不存在时说明原因', async () => {
    show()
    await choose('不是 JSON')
    expect($('[role="alert"]')?.textContent).toContain('不是有效的 JSON 文件')
    await choose(pack({}, { plugin: 'theme' }))
    expect($('[role="alert"]')?.textContent).toContain('扩展里没有这个插件')
  })

  test('导出：只包含和默认值不同的设置，文件名带插件 id', () => {
    const urls: Blob[] = []
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      urls.push(blob as Blob)
      return 'blob:x'
    })
    const clicks: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download)
    })
    const exported = exportPack(meta, { keywords: ['a'], mode: 'fold' })
    expect(exported.settings).toEqual({ keywords: ['a'] })
    expect(clicks).toEqual(['zhihu-browser-filter.json'])
    expect(urls[0]?.type).toBe('application/json')
    create.mockRestore()
    click.mockRestore()
  })
})
