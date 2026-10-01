// 官方插件"阅读模式"：回答、专栏文章的专注阅读视图。
// 用 z.contents.current() 拿到屏幕上方的内容，把它的全文（知乎给的 HTML，先清理过）放进覆盖整个页面的视图里。
// 只用了插件 API 里的命令、快捷键、全局挂载点（overlay）和设置，没有碰知乎的页面结构。

import type { Answer, Article, PageType, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'reader',
  name: '阅读模式',
  version: '0.1.0',
  api: 1,
  description: '回答和文章的专注阅读视图：只留标题、作者和正文，字号、宽度、配色可调',
  settings: {
    fontSize: { type: 'number', label: '字号（px）', default: 18, min: 12, max: 32, step: 1 },
    width: { type: 'number', label: '正文宽度（px）', default: 720, min: 400, max: 1200, step: 20 },
    font: {
      type: 'select',
      label: '字体',
      default: 'serif',
      options: { serif: '宋体 / 衬线', sans: '黑体 / 无衬线' },
    },
    theme: {
      type: 'select',
      label: '配色',
      default: 'auto',
      options: { auto: '跟随系统', light: '浅色', sepia: '护眼（米黄）', dark: '暗色' },
    },
  },
} satisfies PluginMeta

const PAGES: PageType[] = ['question', 'answer', 'article']

const THEMES = {
  light: { bg: '#ffffff', text: '#1a1a1a', muted: '#6b6b6b', link: '#056de8', border: '#e5e5e5' },
  sepia: { bg: '#f4ecd8', text: '#433422', muted: '#7d6c55', link: '#8a4b08', border: '#dccfb0' },
  dark: { bg: '#16181b', text: '#d7d9dc', muted: '#8e9399', link: '#6aa8ff', border: '#2c2f33' },
} as const

const FONTS = {
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, Georgia, serif',
  sans: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif',
} as const

// ---------- 清理正文 ----------

/** 正文里不该有的元素：脚本、样式、外部页面、表单…… */
const REMOVE =
  'script, style, iframe, object, embed, link, meta, base, form, input, button, textarea, select, noscript, template'
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * 把知乎给的正文 HTML 清理成可以放进阅读视图的 DOM：
 * 去掉脚本等元素和所有事件属性，限制链接和图片的协议，延迟加载的图片换成真实地址，外部链接在新标签页打开。
 */
export function sanitizeHtml(html: string, doc: Document = document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const el of parsed.body.querySelectorAll(REMOVE)) el.remove()
  for (const el of parsed.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc') el.removeAttribute(attr.name)
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href')
      if (href && !safeUrl(href)) el.removeAttribute('href')
      else if (href) {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      }
    }
    if (el.tagName === 'IMG') fixImage(el as HTMLImageElement)
  }
  const fragment = doc.createDocumentFragment()
  fragment.append(...doc.importNode(parsed.body, true).childNodes)
  return fragment
}

function safeUrl(value: string): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(value, 'https://www.zhihu.com/').protocol)
  } catch {
    return false
  }
}

/** 知乎的图片先放占位图，真实地址在 data-original / data-actualsrc 里 */
function fixImage(img: HTMLImageElement): void {
  const real = img.getAttribute('data-original') || img.getAttribute('data-actualsrc')
  if (real && safeUrl(real)) img.setAttribute('src', real)
  const src = img.getAttribute('src')
  if (!src || (src.startsWith('data:') && !src.startsWith('data:image/'))) img.removeAttribute('src')
  else if (!src.startsWith('data:') && !safeUrl(src)) img.removeAttribute('src')
  img.removeAttribute('srcset')
  img.setAttribute('loading', 'lazy')
  img.setAttribute('referrerpolicy', 'no-referrer')
}

// ---------- 视图 ----------

export interface ReaderOptions {
  fontSize: number
  width: number
  font: keyof typeof FONTS
  theme: 'auto' | keyof typeof THEMES
}

const pad = (n: number) => String(n).padStart(2, '0')
export function formatDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function themeVars(name: keyof typeof THEMES): string {
  const t = THEMES[name]
  return `--bg: ${t.bg}; --text: ${t.text}; --muted: ${t.muted}; --link: ${t.link}; --border: ${t.border};`
}

export function readerCss(options: ReaderOptions): string {
  const auto =
    options.theme === 'auto'
      ? `.reader { ${themeVars('light')} } @media (prefers-color-scheme: dark) { .reader { ${themeVars('dark')} } }`
      : `.reader { ${themeVars(options.theme)} }`
  return `
${auto}
.reader {
  position: fixed; inset: 0; z-index: 2147483000; overflow: auto;
  background: var(--bg); color: var(--text);
  font: ${options.fontSize}px/1.9 ${FONTS[options.font]};
}
.page { box-sizing: border-box; max-width: ${options.width}px; margin: 0 auto; padding: 56px 24px 96px; }
.close {
  position: fixed; top: 16px; right: 20px; padding: 6px 12px; cursor: pointer;
  color: var(--muted); background: transparent; border: 1px solid var(--border); border-radius: 6px;
  font: 14px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.close:hover { color: var(--text); }
h1 { margin: 0 0 12px; font-size: 1.6em; line-height: 1.4; }
.byline { margin: 0 0 32px; padding-bottom: 16px; color: var(--muted); font-size: 0.8em; border-bottom: 1px solid var(--border); }
.body p, .body li { margin: 0 0 1em; }
.body a { color: var(--link); }
.body img { display: block; max-width: 100%; height: auto; margin: 1em auto; }
.body figure { margin: 1em 0; }
.body figcaption { color: var(--muted); font-size: 0.8em; text-align: center; }
.body blockquote { margin: 1em 0; padding-left: 1em; color: var(--muted); border-left: 3px solid var(--border); }
.body pre { overflow: auto; padding: 12px; font: 0.85em/1.5 ui-monospace, Menlo, Consolas, monospace; background: color-mix(in srgb, var(--text) 6%, transparent); border-radius: 6px; }
.body code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
.body table { border-collapse: collapse; max-width: 100%; overflow: auto; }
.body th, .body td { padding: 6px 12px; border: 1px solid var(--border); }
.body hr { border: 0; border-top: 1px solid var(--border); }
`
}

function render(
  container: HTMLElement,
  content: Answer | Article,
  options: ReaderOptions,
  onClose: () => void,
): () => void {
  const doc = container.ownerDocument
  const style = doc.createElement('style')
  style.textContent = readerCss(options)

  const reader = doc.createElement('div')
  reader.className = 'reader'
  reader.tabIndex = -1
  const page = doc.createElement('article')
  page.className = 'page'

  const title = doc.createElement('h1')
  title.textContent = content.title
  const byline = doc.createElement('p')
  byline.className = 'byline'
  byline.textContent = [
    content.author?.name,
    content.createdAt ? formatDay(content.createdAt) : undefined,
    content.wordCount ? `${content.wordCount} 字` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const body = doc.createElement('div')
  body.className = 'body'
  body.append(sanitizeHtml(content.html ?? '', doc))
  page.append(title, byline, body)

  const close = doc.createElement('button')
  close.type = 'button'
  close.className = 'close'
  close.textContent = '关闭（Esc）'
  close.addEventListener('click', onClose)

  reader.append(page)
  container.append(style, reader, close)
  reader.focus({ preventScroll: true })

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }
  doc.addEventListener('keydown', onKey, true)
  return () => doc.removeEventListener('keydown', onKey, true)
}

export default function reader(z: PluginAPI<typeof meta>) {
  let close: (() => void) | undefined

  const options = (): ReaderOptions => ({
    fontSize: z.settings.get('fontSize'),
    width: z.settings.get('width'),
    font: z.settings.get('font') as ReaderOptions['font'],
    theme: z.settings.get('theme') as ReaderOptions['theme'],
  })

  function hide() {
    close?.()
    close = undefined
  }

  function show() {
    const data = z.contents.current()?.data
    if (!data || (data.type !== 'answer' && data.type !== 'article') || !data.html) {
      z.ui.toast('当前位置没有可以阅读的全文：先展开回答，或者滚动到想读的内容')
      return
    }
    close = z.ui.mount('overlay', container => render(container, data, options(), hide))
  }

  function toggle() {
    if (close) hide()
    else show()
  }

  z.registerCommand('toggle', { title: '打开 / 关闭阅读模式', keywords: ['专注', '全屏'], when: PAGES, run: toggle })
  z.registerShortcut('r', toggle, { description: '打开 / 关闭阅读模式', when: PAGES })

  // 切换页面时关闭；设置变了就用新设置重新打开
  z.on('page', hide)
  z.settings.onChange(() => {
    if (!close) return
    hide()
    show()
  })

  return hide
}
