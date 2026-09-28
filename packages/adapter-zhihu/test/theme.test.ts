import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { findSidebar } from '../src/dom/anchors'
import { createThemeSync, syncingStyles, type ThemeSync } from '../src/theme'
import css from '../src/theme.css?raw'
import { flush } from './page'

const html = document.documentElement
let sync: ThemeSync | undefined
const styles = new Set<HTMLStyleElement>()

/** 模拟插件用 z.addStyle 注入样式，返回移除函数 */
function addStyle(css: string): () => void {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  styles.add(style)
  return () => {
    style.remove()
    styles.delete(style)
  }
}

beforeEach(() => {
  html.setAttribute('data-theme', 'light')
})

afterEach(() => {
  sync?.dispose()
  sync = undefined
  for (const style of styles) style.remove()
  styles.clear()
  for (const name of ['data-theme', 'data-zb-tokens', 'data-zb-scheme', 'data-zb-sidebar']) html.removeAttribute(name)
  document.body.replaceChildren()
})

const attrs = () => ({
  tokens: html.getAttribute('data-zb-tokens'),
  scheme: html.getAttribute('data-zb-scheme'),
  sidebar: html.getAttribute('data-zb-sidebar'),
  theme: html.getAttribute('data-theme'),
})

describe('主题 token', () => {
  test('记下设置了的 token；没有设置时不改动页面', async () => {
    sync = createThemeSync(document)
    sync.sync()
    await flush()
    expect(attrs()).toEqual({ tokens: null, scheme: null, sidebar: null, theme: 'light' })

    const remove = addStyle(':root { --zb-font-size: 17px; --zb-content-width: 960px; --zb-sidebar: none; --zb-x: 1 }')
    sync.sync()
    await flush()
    expect(attrs()).toEqual({
      tokens: 'font-size content-width sidebar',
      scheme: null,
      sidebar: 'none',
      theme: 'light',
    })

    remove()
    sync.sync()
    await flush()
    expect(attrs()).toEqual({ tokens: null, scheme: null, sidebar: null, theme: 'light' })
  })

  test('--zb-color-scheme 切换知乎自带的浅色 / 暗色；取消后还原知乎自己的值', async () => {
    sync = createThemeSync(document)
    const remove = addStyle(':root { --zb-color-scheme: dark }')
    sync.sync()
    await flush()
    expect(attrs()).toMatchObject({ tokens: 'color-scheme', scheme: 'dark', theme: 'dark' })
    remove()
    sync.sync()
    await flush()
    expect(attrs()).toMatchObject({ tokens: null, scheme: null, theme: 'light' })
  })

  test('不认识的配色、不是 none 的右侧栏只记为设置了，不做切换', async () => {
    sync = createThemeSync(document)
    addStyle(':root { --zb-color-scheme: sepia; --zb-sidebar: shown }')
    sync.sync()
    await flush()
    expect(attrs()).toEqual({ tokens: 'color-scheme sidebar', scheme: null, sidebar: null, theme: 'light' })
  })

  test('强制切换时知乎改回去：再改回来，并记下知乎想要的值', async () => {
    sync = createThemeSync(document)
    const remove = addStyle(':root { --zb-color-scheme: dark }')
    sync.sync()
    await flush()
    html.setAttribute('data-theme', 'light')
    await flush()
    expect(html.getAttribute('data-theme')).toBe('dark')
    // 知乎（例如用户在知乎的菜单里）切换成暗色，之后取消强制时按知乎的来
    html.setAttribute('data-theme', 'dark')
    await flush()
    remove()
    sync.sync()
    await flush()
    expect(html.getAttribute('data-theme')).toBe('dark')
  })

  test('不强制时知乎自己切换配色：不干预，之后按知乎最新的值还原', async () => {
    sync = createThemeSync(document)
    html.setAttribute('data-theme', 'dark')
    await flush()
    expect(html.getAttribute('data-theme')).toBe('dark')
    const remove = addStyle(':root { --zb-color-scheme: light }')
    sync.sync()
    await flush()
    expect(html.getAttribute('data-theme')).toBe('light')
    remove()
    sync.sync()
    await flush()
    expect(html.getAttribute('data-theme')).toBe('dark')
  })

  test('同一轮里取消强制切换、知乎又改了配色：按知乎最新的值', async () => {
    sync = createThemeSync(document)
    const remove = addStyle(':root { --zb-color-scheme: dark }')
    sync.sync()
    await flush()
    // 先安排检查，知乎再改（检查在知乎的变化记录送达之前运行）
    remove()
    sync.sync()
    html.setAttribute('data-theme', 'dark')
    await flush()
    expect(html.getAttribute('data-theme')).toBe('dark')
  })

  test('同一轮里先检查、后被知乎改掉，不会把知乎的值改回去', async () => {
    sync = createThemeSync(document)
    sync.sync()
    html.setAttribute('data-theme', 'dark')
    await flush()
    expect(html.getAttribute('data-theme')).toBe('dark')
  })

  test('知乎反复改回去时不再争，配色设置变化后再试', async () => {
    let t = 0
    sync = createThemeSync(document, { maxReapply: 3, reapplyWindowMs: 1000, now: () => t })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const remove = addStyle(':root { --zb-color-scheme: dark }')
    sync.sync()
    await flush()
    for (let i = 0; i < 4; i++) {
      html.setAttribute('data-theme', 'light')
      await flush()
    }
    expect(html.getAttribute('data-theme')).toBe('light')
    expect(warn).toHaveBeenCalledTimes(1)
    // 让步之后不再补暗色的导航栏
    expect(html.getAttribute('data-zb-scheme')).toBeNull()
    html.setAttribute('data-theme', 'light')
    await flush()
    expect(html.getAttribute('data-theme')).toBe('light')

    // 换一种配色：重新开始
    remove()
    addStyle(':root { --zb-color-scheme: light }')
    sync.sync()
    await flush()
    expect(html.getAttribute('data-zb-scheme')).toBe('light')
    t = 5000
    html.setAttribute('data-theme', 'dark')
    await flush()
    expect(html.getAttribute('data-theme')).toBe('light')
    warn.mockRestore()
  })

  test('知乎设置成和插件一样的配色不算来回争', async () => {
    sync = createThemeSync(document, { maxReapply: 2 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    addStyle(':root { --zb-color-scheme: dark }')
    sync.sync()
    await flush()
    for (let i = 0; i < 3; i++) {
      html.setAttribute('data-theme', 'dark')
      await flush()
    }
    expect(warn).not.toHaveBeenCalled()
    html.setAttribute('data-theme', 'light')
    await flush()
    expect(html.getAttribute('data-theme')).toBe('dark')
    warn.mockRestore()
  })

  test('知乎切换配色后重新检查（插件可以按知乎的配色设置 token）', async () => {
    sync = createThemeSync(document)
    addStyle('html[data-theme="dark"] { --zb-font-size: 18px }')
    sync.sync()
    await flush()
    expect(attrs().tokens).toBeNull()
    html.setAttribute('data-theme', 'dark')
    await flush()
    await flush()
    expect(attrs().tokens).toBe('font-size')
  })

  test('系统的浅色 / 暗色设置变化时重新检查', async () => {
    let onChange: (() => void) | undefined
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: (_: string, fn: () => void) => {
        onChange = fn
      },
      removeEventListener: () => {
        onChange = undefined
      },
    } as unknown as MediaQueryList)
    sync = createThemeSync(document)
    addStyle(':root { --zb-color-scheme: dark }')
    expect(attrs().scheme).toBeNull()
    onChange?.()
    await flush()
    expect(attrs().scheme).toBe('dark')
    sync.dispose()
    expect(onChange).toBeUndefined()
    matchMedia.mockRestore()
  })

  test('多次 sync() 只检查一次；销毁后还原页面', async () => {
    sync = createThemeSync(document)
    const read = vi.spyOn(window, 'getComputedStyle')
    addStyle(':root { --zb-color-scheme: dark; --zb-sidebar: none }')
    sync.sync()
    sync.sync()
    sync.sync()
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    read.mockRestore()
    expect(attrs()).toEqual({ tokens: 'color-scheme sidebar', scheme: 'dark', sidebar: 'none', theme: 'dark' })
    sync.dispose()
    expect(attrs()).toEqual({ tokens: null, scheme: null, sidebar: null, theme: 'light' })
    sync.sync()
    await flush()
    expect(attrs().tokens).toBeNull()
  })

  test('syncingStyles：样式增减之后重新检查，移除只生效一次', () => {
    const theme = { sync: vi.fn(), dispose() {} }
    const removed = vi.fn()
    const add = syncingStyles(() => removed, theme)
    const remove = add('.x {}')
    expect(theme.sync).toHaveBeenCalledTimes(1)
    remove()
    remove()
    expect(removed).toHaveBeenCalledTimes(1)
    expect(theme.sync).toHaveBeenCalledTimes(2)
  })

  test('右侧栏被隐藏时，sidebar 挂载点改放到工具栏里', () => {
    document.body.innerHTML = '<div class="Question-sideColumn"></div>'
    expect(findSidebar(document)?.className).toBe('Question-sideColumn')
    html.setAttribute('data-zb-sidebar', 'none')
    expect(findSidebar(document)).toBeNull()
    html.removeAttribute('data-zb-sidebar')
  })
})

describe('映射样式（theme.css）', () => {
  // 逐条检查规则匹配到哪些元素、声明了什么（happy-dom 的层叠计算和浏览器不完全一样，实际效果由端到端测试在 Chromium 里检查）
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  const rules = [...sheet.cssRules].filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)

  function declared(selector: string): Record<string, string> {
    const el = document.querySelector(selector)
    if (!el) throw new Error(`找不到 ${selector}`)
    const out: Record<string, string> = {}
    for (const rule of rules) {
      if (!el.matches(rule.selectorText)) continue
      for (let i = 0; i < rule.style.length; i++) {
        const name = rule.style.item(i)
        out[name] = rule.style.getPropertyValue(name)
      }
    }
    return out
  }

  const PAGE = `
    <header class="AppHeader"></header>
    <div class="QuestionHeader"><div class="QuestionHeader-content"><div class="QuestionHeader-main"><h1 class="QuestionHeader-title">问题</h1></div><div class="QuestionHeader-side"></div></div></div>
    <div class="Question-main"><div class="Question-mainColumn"><div class="ContentItem"><h2 class="ContentItem-title">标题</h2><div class="RichText">正文</div></div></div><div class="Question-sideColumn"></div></div>
    <div class="Topstory-container"><div class="Topstory-mainColumn"></div><div class="GlobalSideBar"></div></div>
    <article class="Post-Main"><header class="Post-Header"><h1 class="Post-Title">文章</h1></header><div class="Post-RichTextContainer"></div></article>`
  const selectors = [
    'html',
    '.AppHeader',
    '.QuestionHeader-content',
    '.QuestionHeader-main',
    '.QuestionHeader-side',
    '.Question-main',
    '.Question-mainColumn',
    '.Question-sideColumn',
    '.ContentItem-title',
    '.RichText',
    '.Topstory-container',
    '.Topstory-mainColumn',
    '.GlobalSideBar',
    '.Post-Header',
    '.Post-Title',
    '.Post-RichTextContainer',
  ]

  test('规则都能解析', () => {
    expect(rules.length).toBe(css.match(/\{/g)?.length)
  })

  /** 在 <html> 上做标记，再重新生成页面元素（happy-dom 会缓存元素的选择器匹配结果，祖先的属性变了也不刷新） */
  function render(marks: Record<string, string> = {}): void {
    for (const name of ['data-zb-tokens', 'data-zb-scheme', 'data-zb-sidebar']) html.removeAttribute(name)
    for (const [name, value] of Object.entries(marks)) html.setAttribute(name, value)
    document.body.innerHTML = PAGE
  }

  test('没有设置 token 时不影响知乎的任何元素', () => {
    render()
    for (const selector of selectors) expect([selector, declared(selector)]).toEqual([selector, {}])
  })

  test('设置了 token 时映射到对应的元素', () => {
    render({ 'data-zb-tokens': 'font-family font-size line-height content-width' })
    expect(declared('.RichText')).toEqual({
      'font-family': 'var(--zb-font-family)',
      'font-size': 'var(--zb-font-size)',
      'line-height': 'var(--zb-line-height)',
    })
    for (const title of ['.ContentItem-title', '.QuestionHeader-title', '.Post-Title']) {
      expect(declared(title)).toEqual({ 'font-family': 'var(--zb-font-family)' })
    }
    for (const container of ['.Question-main', '.Topstory-container', '.QuestionHeader-content']) {
      expect(declared(container)).toMatchObject({ width: 'fit-content', 'max-width': '100%' })
    }
    for (const main of [
      '.Question-mainColumn',
      '.Topstory-mainColumn',
      '.QuestionHeader-main',
      '.Post-RichTextContainer',
    ]) {
      expect(declared(main)).toMatchObject({ width: 'var(--zb-content-width)', 'max-width': '100%' })
    }
    expect(declared('.GlobalSideBar')).toEqual({})

    render({ 'data-zb-tokens': 'sidebar', 'data-zb-sidebar': 'none' })
    for (const side of ['.GlobalSideBar', '.Question-sideColumn', '.QuestionHeader-side']) {
      expect(declared(side)).toEqual({ display: 'none' })
    }
    // 只隐藏右侧栏时，外框同样收缩居中，主栏保持知乎的宽度
    expect(declared('.Question-main')).toMatchObject({ width: 'fit-content' })
    expect(declared('.Question-mainColumn')).toEqual({})
  })

  test('暗色：浏览器控件的配色和导航栏', () => {
    render({ 'data-zb-tokens': 'color-scheme', 'data-zb-scheme': 'dark' })
    expect(declared('html')).toEqual({ 'color-scheme': 'dark' })
    expect(declared('.AppHeader')).toMatchObject({ 'background-color': '#1a1a1a' })
    render({ 'data-zb-tokens': 'color-scheme', 'data-zb-scheme': 'light' })
    expect(declared('html')).toEqual({ 'color-scheme': 'light' })
    expect(declared('.AppHeader')).toEqual({})
  })
})
