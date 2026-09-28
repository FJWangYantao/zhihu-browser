import type { Content, ContentHandle } from '@zhihu-browser/sdk'
import { COLLAPSE_SELECTOR, EXPAND_SELECTOR } from './anchors'
import { isFolded, openFold } from './item-ui'

/** 知乎顶部导航栏的高度：滚动定位和判断"在视口内"时要让开它 */
export const HEADER_OFFSET = 60

/** 一块内容的操作（z.contents 返回的就是它） */
export function createHandle(el: HTMLElement, data: () => Content): ContentHandle {
  const win = () => el.ownerDocument.defaultView
  return {
    get data() {
      return data()
    },
    expand() {
      // 被折叠时先展开折叠，再用知乎自己的"阅读全文"
      if (isFolded(el)) openFold(el)
      el.querySelector<HTMLElement>(EXPAND_SELECTOR)?.click()
    },
    collapse() {
      el.querySelector<HTMLElement>(COLLAPSE_SELECTOR)?.click()
    },
    scrollIntoView() {
      const w = win()
      if (!w) return
      const top = el.getBoundingClientRect().top + w.scrollY - HEADER_OFFSET
      w.scrollTo({ top, behavior: 'smooth' })
    },
    isVisible() {
      const w = win()
      if (!w || !el.isConnected) return false
      const rect = el.getBoundingClientRect()
      return rect.height > 0 && rect.bottom > HEADER_OFFSET && rect.top < w.innerHeight
    },
  }
}
