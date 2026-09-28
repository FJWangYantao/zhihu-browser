// 主题 token（插件 API 第 10.3 节）：插件在 :root 上设置 --zb-* 变量，例如
// z.addStyle(':root { --zb-font-size: 17px }')，适配层把它们映射到知乎页面上。
//
// CSS 没法判断一个变量有没有设置，所以由这里读取 <html> 计算后的样式，把设置了的 token 记在
// <html data-zb-tokens> 上，theme.css 只对记下的 token 生效。没有设置的 token 不改变知乎的样子。
// 两个关键字 token 需要额外处理：
// - --zb-color-scheme: light | dark：切换知乎自带的浅色 / 暗色样式（<html data-theme>），
//   同时记在 data-zb-scheme 上（theme.css 据此补上暗色下的导航栏）；
// - --zb-sidebar: none：隐藏右侧栏，记在 data-zb-sidebar 上。
//
// 什么时候重新检查：插件的样式有增减之后（调用 sync()）、系统的浅色 / 暗色设置变化时、知乎自己切换 data-theme 时。

import type { Dispose } from '@zhihu-browser/sdk'

/** 适配层能映射的 token（去掉 --zb- 前缀） */
export const THEME_TOKENS = [
  'color-scheme',
  'font-family',
  'font-size',
  'line-height',
  'content-width',
  'sidebar',
] as const

export type ThemeToken = (typeof THEME_TOKENS)[number]

export interface ThemeSync {
  /** 插件的样式有增减：在当前任务结束前重新检查 token（多次调用只检查一次） */
  sync(): void
  dispose(): void
}

export interface ThemeSyncOptions {
  /** 知乎持续把 data-theme 改回去时，一段时间内最多再改几次，默认 10 */
  maxReapply?: number
  /** 上面的"一段时间"（毫秒），默认 10000 */
  reapplyWindowMs?: number
  now?: () => number
  /** <html> 上的标记（设置了哪些 token、配色、右侧栏）变化之后调用 */
  onChange?: () => void
}

const SCHEMES = new Set(['light', 'dark'])

export function createThemeSync(doc: Document, options: ThemeSyncOptions = {}): ThemeSync {
  const root = doc.documentElement
  const win = doc.defaultView
  const now = options.now ?? Date.now
  const maxReapply = options.maxReapply ?? 10
  const reapplyWindow = options.reapplyWindowMs ?? 10_000
  /** 知乎自己想要的 data-theme：强制切换时记下，取消时还原 */
  let zhihuTheme = root.getAttribute('data-theme')
  /** 插件要求的配色；undefined 表示跟随知乎 */
  let forced: string | undefined
  let reapplied: number[] = []
  let gaveUp = false
  let scheduled = false
  let disposed = false
  /** 我们自己改 data-theme 产生的、还没处理的变化记录 */
  let ownWrites = 0

  function setAttr(name: string, value: string | null | undefined): void {
    if (value === null || value === undefined || value === '') {
      if (root.hasAttribute(name)) root.removeAttribute(name)
    } else if (root.getAttribute(name) !== value) root.setAttribute(name, value)
  }

  /**
   * 处理 data-theme 的变化记录：跳过我们自己的修改，记下别人（知乎）设置的值。返回有没有别人的修改。
   * 我们每次修改之前都会先处理掉已有的记录（见 applyTheme），所以一批记录里我们自己的修改只可能在最前面，
   * 别人的修改在后面，现在的值就是别人最后设置的值。
   */
  function absorb(records: MutationRecord[]): boolean {
    const own = Math.min(ownWrites, records.length)
    ownWrites -= own
    if (records.length === own) return false
    zhihuTheme = root.getAttribute('data-theme')
    return true
  }

  /** 把 data-theme 设成应有的值：插件要求的配色，或者知乎自己的值 */
  function applyTheme(): void {
    // 先处理掉还没处理的记录：知乎刚改的值要先记下，接下来的那条记录也一定是我们自己的
    if (observer) absorb(observer.takeRecords())
    const value = forced ?? zhihuTheme
    if (root.getAttribute('data-theme') === value) return
    ownWrites++
    setAttr('data-theme', value)
  }

  const marks = () => ['data-zb-tokens', 'data-zb-scheme', 'data-zb-sidebar'].map(n => root.getAttribute(n)).join('|')

  function check(): void {
    scheduled = false
    if (disposed) return
    const before = marks()
    const style = win?.getComputedStyle(root)
    const values = new Map<ThemeToken, string>()
    for (const token of THEME_TOKENS) {
      const value = style?.getPropertyValue(`--zb-${token}`).trim()
      if (value) values.set(token, value)
    }
    setAttr('data-zb-tokens', [...values.keys()].join(' '))
    setAttr('data-zb-sidebar', values.get('sidebar') === 'none' ? 'none' : undefined)
    const scheme = values.get('color-scheme')
    const nextForced = scheme && SCHEMES.has(scheme) ? scheme : undefined
    if (nextForced !== forced) {
      // 只在开始、结束或改变强制切换时写 data-theme，平时不碰知乎自己的值
      forced = nextForced
      gaveUp = false
      reapplied = []
      applyTheme()
    }
    // 暗色下补上导航栏等样式：只在确实由插件切换了配色时生效
    setAttr('data-zb-scheme', gaveUp ? undefined : forced)
    if (marks() !== before) options.onChange?.()
  }

  function schedule(): void {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(check)
  }

  // 知乎（或者别的代码）改了 data-theme：记下知乎想要的值；我们在强制切换时改回去
  const observer = win
    ? new win.MutationObserver(records => {
        if (!absorb(records)) return
        if (forced && !gaveUp && root.getAttribute('data-theme') !== forced) {
          const t = now()
          reapplied = reapplied.filter(at => t - at < reapplyWindow)
          if (reapplied.length >= maxReapply) {
            // 不和知乎来回争：这次改由知乎决定，插件的配色设置变化时再试
            gaveUp = true
            console.warn('[zhihu-browser] 知乎反复切换浅色 / 暗色，暂时跟随知乎')
          } else {
            reapplied.push(t)
            applyTheme()
          }
        }
        // 插件可能按知乎的配色设置 token（如 html[data-theme="dark"] { … }）
        schedule()
      })
    : undefined
  observer?.observe(root, { attributes: true, attributeFilter: ['data-theme'] })

  const media = win?.matchMedia?.('(prefers-color-scheme: dark)')
  media?.addEventListener?.('change', schedule)

  return {
    sync: schedule,
    dispose() {
      if (disposed) return
      disposed = true
      if (observer) absorb(observer.takeRecords())
      observer?.disconnect()
      media?.removeEventListener?.('change', schedule)
      for (const name of ['data-zb-tokens', 'data-zb-scheme', 'data-zb-sidebar']) setAttr(name, undefined)
      if (forced) setAttr('data-theme', zhihuTheme)
    },
  }
}

/** 把一个注入样式的函数包起来：样式增减之后重新检查 token */
export function syncingStyles(add: (css: string) => Dispose, theme: ThemeSync): (css: string) => Dispose {
  return css => {
    const remove = add(css)
    theme.sync()
    let removed = false
    return () => {
      if (removed) return
      removed = true
      remove()
      theme.sync()
    }
  }
}
