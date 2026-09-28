import { createHost, createMemorySettingsBackend, createMemoryStorageBackend, type LogEntry } from '@zhihu-browser/core'
import { describe, expect, test } from 'vitest'
import * as themePlugin from '../src/index'
import { safeFontFamily, type ThemeSettings, themeCss } from '../src/index'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const defaults: ThemeSettings = {
  colorScheme: 'zhihu',
  fontFamily: 'default',
  customFont: '',
  fontSize: 'default',
  lineHeight: 'default',
  contentWidth: 'default',
  hideSidebar: false,
}

async function setup(settings: Record<string, unknown> = {}) {
  const backend = createMemorySettingsBackend({ theme: settings })
  const styles = new Set<string>()
  let added = 0
  const logs: LogEntry[] = []
  const host = createHost({
    services: {
      settings: backend,
      storage: createMemoryStorageBackend(),
      fetch: async () => {
        throw new Error('不访问网络')
      },
      ui: { toast() {}, confirm: async () => true, mount: () => () => {} },
      addStyle(css) {
        added++
        styles.add(css)
        return () => styles.delete(css)
      },
      contents: { all: () => [], current: () => undefined },
      log: entry => logs.push(entry),
    },
  })
  await host.load(themePlugin)
  return {
    host,
    styles,
    logs,
    added: () => added,
    update: async (values: Record<string, unknown>) => {
      backend.update('theme', { ...backend.peek('theme'), ...values })
      await flush()
    },
  }
}

describe('生成的样式', () => {
  test('全部是默认值时不注入样式', () => {
    expect(themeCss(defaults)).toBe('')
  })

  test('只设置主题 token，不写知乎的选择器', () => {
    const css = themeCss({
      ...defaults,
      colorScheme: 'dark',
      fontFamily: 'kai',
      fontSize: '18px',
      lineHeight: '2.0',
      contentWidth: '960px',
      hideSidebar: true,
    })
    expect(css).toBe(
      [
        ':root {',
        '  --zb-color-scheme: dark;',
        '  --zb-font-family: "LXGW WenKai", "Kaiti SC", STKaiti, KaiTi, serif;',
        '  --zb-font-size: 18px;',
        '  --zb-line-height: 2.0;',
        '  --zb-content-width: 960px;',
        '  --zb-sidebar: none;',
        '}',
      ].join('\n'),
    )
    expect(css).not.toMatch(/\.[A-Z]/)
  })

  test('跟随系统：默认浅色，系统是暗色时用暗色', () => {
    expect(themeCss({ ...defaults, colorScheme: 'system' })).toBe(
      ':root {\n  --zb-color-scheme: light;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --zb-color-scheme: dark;\n  }\n}',
    )
  })

  test('自定义字体：只接受字体名称，其他写法忽略', () => {
    expect(safeFontFamily(' "LXGW WenKai", 霞鹜文楷, serif ')).toBe('"LXGW WenKai", 霞鹜文楷, serif')
    expect(safeFontFamily("'Noto Serif SC', serif")).toBe("'Noto Serif SC', serif")
    for (const bad of [
      '',
      '  ',
      'serif; } body { display: none',
      'x { }',
      'url(https://example.com)',
      '"未闭合',
      'a\\62 c',
    ]) {
      expect(safeFontFamily(bad)).toBeUndefined()
    }
    expect(safeFontFamily('a'.repeat(201))).toBeUndefined()
    expect(themeCss({ ...defaults, fontFamily: 'custom', customFont: 'Georgia, serif' })).toContain(
      '--zb-font-family: Georgia, serif;',
    )
    expect(themeCss({ ...defaults, fontFamily: 'custom', customFont: 'serif; color: red' })).toBe('')
    // 没选"自定义"时不用自定义字体
    expect(themeCss({ ...defaults, customFont: 'Georgia' })).toBe('')
  })
})

describe('插件', () => {
  test('默认设置下页面保持原样；设置变化时替换样式；停用时移除', async () => {
    const t = await setup()
    expect([...t.styles]).toEqual([])
    await t.update({ colorScheme: 'dark' })
    expect([...t.styles]).toEqual([':root {\n  --zb-color-scheme: dark;\n}'])
    await t.update({ fontSize: '17px' })
    expect([...t.styles]).toEqual([':root {\n  --zb-color-scheme: dark;\n  --zb-font-size: 17px;\n}'])
    await t.update({ colorScheme: 'zhihu', fontSize: 'default' })
    expect([...t.styles]).toEqual([])
    await t.update({ hideSidebar: true })
    expect(t.styles.size).toBe(1)
    t.host.disable('theme')
    expect([...t.styles]).toEqual([])
  })

  test('和样式无关的设置变化不重新注入样式', async () => {
    const t = await setup({ colorScheme: 'dark' })
    expect(t.added()).toBe(1)
    // 没选"自定义"字体，改自定义字体不影响样式
    await t.update({ customFont: 'Georgia' })
    expect(t.added()).toBe(1)
    await t.update({ fontFamily: 'custom' })
    expect(t.added()).toBe(2)
  })

  test('自定义字体写法不对时记一条警告', async () => {
    const t = await setup({ fontFamily: 'custom', customFont: 'serif; color: red' })
    expect([...t.styles]).toEqual([])
    expect(t.logs.map(l => `${l.level}:${l.message}`)).toContain(
      'warn:自定义字体里有不支持的字符，已改用知乎默认的字体',
    )
  })
})
