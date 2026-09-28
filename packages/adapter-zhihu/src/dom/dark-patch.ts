// 暗色补丁：插件要求暗色（--zb-color-scheme: dark）时，知乎有些模块不跟着 <html data-theme> 变暗，
// 例如评论区、加载中的占位、右下角的按钮、导航栏的文字（很可能是知乎在脚本里按自己的浅色状态生成的样式）：
// 文字还是浅色主题的深色，背景还是白色，在暗色页面上看不清。
//
// 这里按颜色找出这些元素并做标记，由 theme.css 改成暗色，不依赖类名：
// - 周围是暗色、自己是白色的块 → data-zb-dark-bg
// - 暗色背景上看不清的文字（对比度不到 3:1）→ data-zb-dark-text
// - 暗色背景上的浅色边框、分割线 → data-zb-dark-border
//
// 只在插件要求暗色时运行（由 isolated.ts 按 <html data-zb-scheme> 启停），跟随知乎时不改动页面。
// 新插入的元素在 MutationObserver 的回调里处理，这时浏览器还没绘制，不会先闪白。

export type RGBA = readonly [number, number, number, number]

export const DARK_MARKS = ['data-zb-dark-bg', 'data-zb-dark-text', 'data-zb-dark-border'] as const

/** 背景亮度低于这个值算暗色 */
const DARK = 0.2
/** 背景、边框亮度不低于这个值算浅色 */
const LIGHT = 0.6
/** 文字和背景的对比度低于这个值算看不清 */
const MIN_CONTRAST = 3
/** 没有设置背景色时，暗色页面的底色（#121212） */
const PAGE_DARK = 0.006
/** 一次同步处理的元素上限，多出来的分批处理 */
const CHUNK = 800
/** class 变化引起的重新检查，延迟这么久合并处理（毫秒） */
const ATTRIBUTE_DELAY = 100
/** 样式表加载、页面解析完之后整页重新检查，延迟合并（毫秒） */
const FULL_PASS_DELAY = 50
/** 改亮文字时保留色相的饱和度下限：低于它的颜色（灰色）直接用浅灰 */
const MIN_SATURATION = 0.25

const SKIP_TAGS = new Set([
  'img',
  'video',
  'canvas',
  'iframe',
  'svg',
  'picture',
  'input',
  'textarea',
  'select',
  'option',
  'script',
  'style',
  'link',
  'meta',
  'noscript',
  'br',
  'hr',
])

/** 解析计算后的颜色：rgb()、rgba()、#rgb、#rrggbb、#rrggbbaa、transparent；其他写法返回 undefined */
export function parseColor(value: string): RGBA | undefined {
  const v = value.trim().toLowerCase()
  if (v === 'transparent') return [0, 0, 0, 0]
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex
    if (full.length !== 6 && full.length !== 8) return undefined
    const byte = (i: number) => Number.parseInt(full.slice(i, i + 2), 16)
    return [byte(0), byte(2), byte(4), full.length === 8 ? byte(6) / 255 : 1]
  }
  const args = /^rgba?\(([^)]*)\)$/.exec(v)?.[1]
  if (args === undefined) return undefined
  const parts = args.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return undefined
  const num = (p: string, scale: number) =>
    p.endsWith('%') ? (Number.parseFloat(p) / 100) * scale : Number.parseFloat(p)
  const rgba = [
    num(parts[0] ?? '', 255),
    num(parts[1] ?? '', 255),
    num(parts[2] ?? '', 255),
    parts[3] ? num(parts[3], 1) : 1,
  ]
  return rgba.some(Number.isNaN) ? undefined : (rgba as unknown as RGBA)
}

/** 相对亮度（WCAG） */
export function luminance([r, g, b]: RGBA): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** 对比度（WCAG），1～21 */
export function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** 有颜色的文字（如蓝色链接）改亮时保留色相：返回同色相的浅色；灰色返回 undefined（用 theme.css 里的浅灰） */
export function lightened([r, g, b]: RGBA): string | undefined {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (s < MIN_SATURATION) return undefined
  let h: number
  if (max === r / 255) h = ((g - b) / 255 / d) % 6
  else if (max === g / 255) h = (b - r) / 255 / d + 2
  else h = (r - g) / 255 / d + 4
  const hue = Math.round((h * 60 + 360) % 360)
  return `hsl(${hue}, ${Math.round(Math.min(s, 0.8) * 100)}%, 72%)`
}

/** 不检查的元素：图片、视频、表单控件、svg、我们自己的界面 */
export function skipForDark(el: Element): boolean {
  return SKIP_TAGS.has(el.localName) || 'ownerSVGElement' in el || !!el.closest('[data-zb-ui], svg')
}

/** 元素有没有自己的文字（不算子元素里的） */
export const hasOwnText = (el: Element) =>
  [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')

/**
 * 元素实际显示在上面的背景的亮度：往上找第一个不透明的背景色；都没有时按暗色页面的底色算。
 * 有背景图片时无法判断，返回 null。cache 在同一轮检查里共用。
 */
export function backgroundLuminance(
  el: Element,
  win: Window,
  cache = new Map<Element, number | null>(),
): number | null {
  const walked: Element[] = []
  let result: number | null = PAGE_DARK
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cached = cache.get(e)
    if (cached !== undefined) {
      result = cached
      break
    }
    walked.push(e)
    const cs = win.getComputedStyle(e)
    const image = cs.backgroundImage
    if (image && image !== 'none') {
      result = null
      break
    }
    const bg = parseColor(cs.backgroundColor)
    if (bg && bg[3] >= 0.5) {
      result = luminance(bg)
      break
    }
  }
  for (const e of walked) cache.set(e, result)
  return result
}

/** 暗色背景上看不清的文字：返回文字颜色；看得清、不是暗色背景或无法判断时返回 undefined */
export function unreadableColor(el: Element, win: Window, cache: Map<Element, number | null>): RGBA | undefined {
  const bg = backgroundLuminance(el, win, cache)
  if (bg === null || bg >= DARK) return undefined
  const color = parseColor(win.getComputedStyle(el).color)
  return color && color[3] >= 0.4 && contrast(luminance(color), bg) < MIN_CONTRAST ? color : undefined
}

export interface DarkPatch {
  /** 各种标记的数量 */
  stats(): { bg: number; text: number; border: number }
  dispose(): void
}

export function startDarkPatch(doc: Document): DarkPatch {
  const view = doc.defaultView
  if (!view) return { stats: () => ({ bg: 0, text: 0, border: 0 }), dispose() {} }
  const win: Window & typeof globalThis = view
  const root = doc.documentElement
  const style = (el: Element) => win.getComputedStyle(el)
  let disposed = false
  let attributeTimer: ReturnType<typeof setTimeout> | undefined
  let fullPassTimer: ReturnType<typeof setTimeout> | undefined
  const chunkTimers = new Set<ReturnType<typeof setTimeout>>()
  const attributeTargets = new Set<Element>()

  const skip = skipForDark
  const backgroundOf = (el: Element, cache: Map<Element, number | null>) => backgroundLuminance(el, win, cache)

  /** 周围是暗色、自己是白色的块；页面本身（html、body）不算 */
  function isLightIsland(el: Element, cache: Map<Element, number | null>): boolean {
    if (el === root || el === doc.body) return false
    const cs = style(el)
    const image = cs.backgroundImage
    if (image && image !== 'none') return false
    const bg = parseColor(cs.backgroundColor)
    if (!bg || bg[3] < 0.8 || luminance(bg) < LIGHT) return false
    const around = el.parentElement ? backgroundOf(el.parentElement, cache) : null
    if (around === null || around >= DARK) return false
    const rect = el.getBoundingClientRect()
    return rect.width >= 8 && rect.height >= 8
  }

  /** 看不清的文字：返回原来的颜色（用来保留色相）；看得清时返回 undefined */
  function lowContrastColor(el: Element, cs: CSSStyleDeclaration, bg: number): RGBA | undefined {
    // 改成暗色的白块自己也查：里面跟随文字颜色（currentColor）的图标会一起变亮
    if (!hasOwnText(el) && !el.hasAttribute('data-zb-dark-bg')) return undefined
    const color = parseColor(cs.color)
    return color && color[3] >= 0.4 && contrast(luminance(color), bg) < MIN_CONTRAST ? color : undefined
  }

  function hasLightBorder(cs: CSSStyleDeclaration): boolean {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (!Number.parseFloat(cs.getPropertyValue(`border-${side}-width`))) continue
      const lineStyle = cs.getPropertyValue(`border-${side}-style`)
      if (!lineStyle || lineStyle === 'none' || lineStyle === 'hidden') continue
      const color = parseColor(cs.getPropertyValue(`border-${side}-color`))
      if (color && color[3] >= 0.5 && luminance(color) >= LIGHT) return true
    }
    return false
  }

  /** 处理一批元素：先去掉旧标记按原来的颜色判断，先改背景，再按改过之后的背景判断文字和边框 */
  function unmark(el: Element): void {
    for (const mark of DARK_MARKS) if (el.hasAttribute(mark)) el.removeAttribute(mark)
    if (el instanceof win.HTMLElement && el.style.getPropertyValue('--zb-dark-text')) {
      el.style.removeProperty('--zb-dark-text')
    }
  }

  function processChunk(els: Element[]): void {
    for (const el of els) unmark(el)
    const before = new Map<Element, number | null>()
    const islands = els.filter(el => isLightIsland(el, before))
    for (const el of islands) el.setAttribute('data-zb-dark-bg', '')
    const after = new Map<Element, number | null>()
    const texts: [Element, RGBA][] = []
    const borders: Element[] = []
    for (const el of els) {
      const bg = backgroundOf(el, after)
      if (bg === null || bg >= DARK) continue
      const cs = style(el)
      const color = lowContrastColor(el, cs, bg)
      if (color) texts.push([el, color])
      if (hasLightBorder(cs)) borders.push(el)
    }
    for (const [el, color] of texts) {
      el.setAttribute('data-zb-dark-text', '')
      const light = lightened(color)
      if (light && el instanceof win.HTMLElement) el.style.setProperty('--zb-dark-text', light)
    }
    for (const el of borders) el.setAttribute('data-zb-dark-border', '')
  }

  /** 处理这些元素和它们里面的元素：第一批立即处理（不闪白），其余的分批 */
  function process(roots: Iterable<Element>): void {
    if (disposed) return
    const els: Element[] = []
    const seen = new Set<Element>()
    for (const r of roots) {
      if (!r.isConnected || seen.has(r)) continue
      for (const el of [r, ...r.querySelectorAll('*')]) {
        if (seen.has(el)) continue
        seen.add(el)
        if (!skip(el)) els.push(el)
      }
    }
    processChunk(els.slice(0, CHUNK))
    for (let i = CHUNK; i < els.length; i += CHUNK) {
      const chunk = els.slice(i, i + CHUNK)
      const timer = setTimeout(() => {
        chunkTimers.delete(timer)
        if (!disposed) processChunk(chunk.filter(el => el.isConnected))
      }, 0)
      chunkTimers.add(timer)
    }
  }

  function scheduleFullPass(): void {
    if (disposed) return
    clearTimeout(fullPassTimer)
    fullPassTimer = setTimeout(() => process([root]), FULL_PASS_DELAY)
  }

  /** class 变了的元素：里面的元素不多时连同里面的一起查，否则只查它自己 */
  function processAttributeTargets(): void {
    attributeTimer = undefined
    const targets = [...attributeTargets].filter(el => el.isConnected)
    attributeTargets.clear()
    if (disposed) return
    const small = targets.filter(el => el.getElementsByTagName('*').length <= 300)
    process(small)
    processChunk(targets.filter(el => !small.includes(el) && !skip(el)))
  }

  const observer = new win.MutationObserver(records => {
    if (disposed) return
    const added: Element[] = []
    for (const record of records) {
      if (record.type === 'attributes') attributeTargets.add(record.target as Element)
      else for (const node of record.addedNodes) if (node.nodeType === 1) added.push(node as Element)
    }
    // 新插入的元素立即处理：这时浏览器还没有绘制
    if (added.length) process(added)
    if (attributeTargets.size && attributeTimer === undefined) {
      attributeTimer = setTimeout(processAttributeTargets, ATTRIBUTE_DELAY)
    }
  })
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })

  // 外部样式表加载完、页面解析完、全部加载完时，整页再查一遍：之前查的时候知乎的样式可能还没到
  const onLinkLoad = (event: Event) => {
    if ((event.target as Element | null)?.localName === 'link') scheduleFullPass()
  }
  doc.addEventListener('load', onLinkLoad, true)
  doc.addEventListener('DOMContentLoaded', scheduleFullPass)
  win.addEventListener('load', scheduleFullPass)

  process([root])

  return {
    stats: () => ({
      bg: doc.querySelectorAll('[data-zb-dark-bg]').length,
      text: doc.querySelectorAll('[data-zb-dark-text]').length,
      border: doc.querySelectorAll('[data-zb-dark-border]').length,
    }),
    dispose() {
      if (disposed) return
      disposed = true
      observer.disconnect()
      clearTimeout(attributeTimer)
      clearTimeout(fullPassTimer)
      for (const timer of chunkTimers) clearTimeout(timer)
      doc.removeEventListener('load', onLinkLoad, true)
      doc.removeEventListener('DOMContentLoaded', scheduleFullPass)
      win.removeEventListener('load', scheduleFullPass)
      for (const el of doc.querySelectorAll(DARK_MARKS.map(m => `[${m}]`).join(','))) unmark(el)
    },
  }
}
