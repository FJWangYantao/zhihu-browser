import type { Dispose } from '@zhihu-browser/sdk'

/** 只执行一次的清理函数 */
export function once(fn: () => void): Dispose {
  let done = false
  return () => {
    if (done) return
    done = true
    fn()
  }
}

/** 创建元素：h(doc, 'div', { class: 'x', role: 'dialog' }, '文字', 子元素…) */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) el.setAttribute(name, value)
  for (const child of children) if (child) el.append(child)
  return el
}
