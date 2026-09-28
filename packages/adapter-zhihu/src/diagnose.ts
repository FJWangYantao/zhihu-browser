// 页面结构诊断：在真实知乎上核对锚点用（例如主题用到的两栏布局类名）。
// 只记录标签名、类名、尺寸、显示方式和锚点命中数，不记录任何文字、链接、属性值和内容 id；
// 用户在面板里看过之后自己决定复制给谁，扩展不会上传。

import type { PageInfo } from '@zhihu-browser/sdk'
import { backgroundLuminance, hasOwnText, luminance, parseColor, skipForDark, unreadableColor } from './dom/dark-patch'

/** 统计命中数的选择器：dom/anchors.ts 和 theme.css 里用到的类名 */
export const DIAGNOSE_ANCHORS = [
  '.ContentItem',
  '.HotItem',
  '.QuestionHeader',
  '[data-zop]',
  '.ContentItem-title',
  '.RichText',
  '.ContentItem-actions',
  '.ContentItem-more',
  '.ContentItem-rightButton',
  '.AppHeader',
  '.Topstory-container',
  '.Topstory-mainColumn',
  '.GlobalSideBar',
  '.Question-main',
  '.Question-mainColumn',
  '.Question-sideColumn',
  '.QuestionHeader-content',
  '.QuestionHeader-main',
  '.QuestionHeader-side',
  '.Search-container',
  '.SearchMain',
  '.SearchSideBar',
  '.Profile-main',
  '.Profile-mainColumn',
  '.Profile-sideColumn',
  '.ContentLayout',
  '.ContentLayout-mainColumn',
  '.ContentLayout-sideColumn',
  '.Post-Header',
  '.Post-Title',
  '.Post-RichTextContainer',
  '[data-zb-columns]',
  '[data-zb-side]',
]

const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template'])
/** 每一层最多列出多少个兄弟元素 */
const MAX_CHILDREN = 12
/** 第一块内容的内部结构往下展开几层 */
const CONTENT_DEPTH = 3

/** 元素的写法：标签名、短的英文 id、类名、我们加的标记（只写名字，不写值） */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  // 带数字的 id 可能是内容 id，不写
  const id = /^[A-Za-z][A-Za-z_-]{0,30}$/.test(el.id) ? `#${el.id}` : ''
  const classes = [...el.classList]
    .filter(c => /^[\w-]{1,48}$/.test(c))
    .map(c => `.${c}`)
    .join('')
  const marks = [...el.attributes]
    .filter(a => a.name.startsWith('data-zb-'))
    .map(a => `[${a.name}]`)
    .join('')
  return `${tag}${id}${classes}${marks}`
}

function box(el: Element): string {
  const r = el.getBoundingClientRect()
  const display = el.ownerDocument.defaultView?.getComputedStyle(el).display ?? ''
  return `${Math.round(r.width)}×${Math.round(r.height)}${display ? ` ${display}` : ''}`
}

/** 从 el 往下列出子元素：path 上的元素（▶）接着往下展开，其他的再展开 expand 层；depth 是缩进 */
function tree(el: Element, path: ReadonlySet<Element>, depth: number, expand: number, lines: string[]): void {
  const children = [...el.children].filter(c => !SKIP_TAGS.has(c.tagName.toLowerCase()))
  const indent = '  '.repeat(depth)
  let listed = 0
  let skipped = 0
  for (const child of children) {
    const onPath = path.has(child)
    if (!onPath && listed >= MAX_CHILDREN) {
      skipped++
      continue
    }
    if (!onPath) listed++
    lines.push(`${indent}${onPath ? '▶ ' : '· '}${describeElement(child)}  ${box(child)}`)
    if (onPath || expand > 0) tree(child, path, depth + 1, onPath ? expand : expand - 1, lines)
  }
  if (skipped) lines.push(`${indent}  …另有 ${skipped} 个`)
}

function browserName(win: Window): string {
  const data = (win.navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[] } })
    .userAgentData
  const brand = data?.brands?.find(b => /Chrome|Edge|Chromium/.test(b.brand) && !/Not/.test(b.brand))
  if (brand) return `${brand.brand} ${brand.version}`
  const m = /(Edg|Firefox|Chrome)\/(\d+)/.exec(win.navigator.userAgent)
  return m ? `${m[1]} ${m[2]}` : '未知'
}

/** 暗色检查最多列出几个元素 */
const MAX_DARK_ITEMS = 10

/** 元素和它往上两层的写法，如 span.a < div.b < div.c */
const chain = (el: Element) =>
  [el, el.parentElement, el.parentElement?.parentElement]
    .filter((e): e is Element => !!e)
    .map(describeElement)
    .join(' < ')

/** 暗色时：补丁改了多少、页面里另外设置了 data-theme 的元素、仍然看不清的文字和白色块 */
function darkReport(doc: Document, win: Window): string[] {
  const html = doc.documentElement
  const body = doc.body
  if (!body || (html.getAttribute('data-theme') !== 'dark' && html.getAttribute('data-zb-scheme') !== 'dark')) return []
  const count = (selector: string) => doc.querySelectorAll(selector).length
  const lines = ['', '暗色检查：']
  lines.push(
    `  暗色补丁改了：背景 ${count('[data-zb-dark-bg]')} 个、文字 ${count('[data-zb-dark-text]')} 个、边框 ${count('[data-zb-dark-border]')} 个`,
  )
  const scopes = [...body.querySelectorAll('[data-theme]')]
  lines.push(`  页面里另外设置了 data-theme 的元素：${scopes.length} 个`)
  for (const el of scopes.slice(0, MAX_DARK_ITEMS)) {
    lines.push(`    · ${describeElement(el)} data-theme="${el.getAttribute('data-theme')}"`)
  }

  const cache = new Map<Element, number | null>()
  const unreadable: string[] = []
  const islands: string[] = []
  for (const el of body.querySelectorAll('*')) {
    if (unreadable.length >= MAX_DARK_ITEMS && islands.length >= MAX_DARK_ITEMS) break
    if (skipForDark(el) || el.getClientRects().length === 0) continue
    if (hasOwnText(el) && unreadable.length < MAX_DARK_ITEMS) {
      const color = unreadableColor(el, win, cache)
      if (color) unreadable.push(`    · ${chain(el)}  文字 ${win.getComputedStyle(el).color}`)
    }
    if (islands.length < MAX_DARK_ITEMS && el.parentElement && el !== body) {
      const bg = parseColor(win.getComputedStyle(el).backgroundColor)
      const around = backgroundLuminance(el.parentElement, win, cache)
      if (bg && bg[3] >= 0.8 && luminance(bg) >= 0.6 && around !== null && around < 0.2) {
        islands.push(`    · ${chain(el)}  背景 ${win.getComputedStyle(el).backgroundColor}`)
      }
    }
  }
  lines.push(`  仍然看不清的文字：${unreadable.length ? '' : '没有'}`, ...unreadable)
  lines.push(`  暗色背景上仍然是浅色的块：${islands.length ? '' : '没有'}`, ...islands)
  return lines
}

export interface DiagnoseOptions {
  page: PageInfo
  /** 扩展的版本 */
  version?: string
  /** 从哪块内容开始往上看；不提供时用页面上的第一块内容 */
  start?: Element
}

/** 生成诊断信息（纯文本） */
export function describePage(doc: Document, options: DiagnoseOptions): string {
  const win = doc.defaultView
  const html = doc.documentElement
  const lines = ['zhihu-browser 页面结构诊断（只有标签名、类名和尺寸，不含文字、链接和账号信息）']
  lines.push(`扩展版本：${options.version ?? '未知'} · 页面类型：${options.page.type}`)
  if (win) {
    lines.push(`窗口：${win.innerWidth}×${win.innerHeight}，缩放 ${win.devicePixelRatio} · 浏览器：${browserName(win)}`)
  }
  const marks = ['data-theme', 'data-zb-tokens', 'data-zb-scheme', 'data-zb-sidebar', 'data-zb-prehide']
    .filter(name => html.hasAttribute(name))
    .map(name => `${name}="${html.getAttribute(name)}"`)
  lines.push(`<html> 上的标记：${marks.join(' ') || '无'}`)

  lines.push('', '锚点命中数：')
  for (const selector of DIAGNOSE_ANCHORS) lines.push(`  ${selector}  ${doc.querySelectorAll(selector).length}`)

  const start =
    options.start ??
    doc.querySelector('[data-zb-id]:not(.QuestionHeader)') ??
    doc.querySelector('.ContentItem, .HotItem, [data-zop]')
  const body = doc.body
  lines.push('', '页面结构（从第一块内容往上到 body，▶ 是包含这块内容的一支，每层列出兄弟元素）：')
  if (!body || !start || !body.contains(start)) {
    lines.push('  页面上没有找到内容')
  } else {
    // 内容本身不在 path 里：它只列一行，内部结构单独列在后面
    const path = new Set<Element>()
    for (let e = start.parentElement; e && e !== body; e = e.parentElement) path.add(e)
    lines.push(`body  ${box(body)}`)
    tree(body, path, 1, 0, lines)
    lines.push('', `第一块内容（${describeElement(start)}）的内部结构：`)
    tree(start, new Set(), 1, CONTENT_DEPTH - 1, lines)
  }
  if (win) lines.push(...darkReport(doc, win))
  return lines.join('\n')
}
