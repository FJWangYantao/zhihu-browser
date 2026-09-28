// 两栏布局（主栏 + 右侧栏）：按元素的位置识别，不依赖类名。
// 知乎经常改右侧栏的类名，有时只剩 css-xxxxxx 这类自动生成的类名，按位置找更可靠。
// theme.css 先按类名隐藏右侧栏（立即生效），这里找到的作为补充（内容出现之后才能找）。

/** 右侧栏至少这么大，避免把主栏旁边的小按钮当成右侧栏 */
const MIN_SIDE_WIDTH = 120
const MIN_SIDE_HEIGHT = 60

export interface Columns {
  /** 两栏的外框 */
  container: HTMLElement
  /** 主栏：外框的子元素，包含内容 */
  main: HTMLElement
  /** 右侧栏：外框的子元素，在主栏右边，比主栏窄 */
  side: HTMLElement
}

/** 从一块内容往上找：哪一层的父元素里有另一个子元素排在它右边、上下有重叠，那个子元素就是右侧栏 */
export function findColumns(content: HTMLElement): Columns | undefined {
  const body = content.ownerDocument.body
  for (let main = content; main.parentElement && main.parentElement !== body; main = main.parentElement) {
    const container = main.parentElement
    const m = main.getBoundingClientRect()
    if (!m.width) continue
    for (const side of container.children) {
      if (side === main) continue
      const s = side.getBoundingClientRect()
      if (s.width < MIN_SIDE_WIDTH || s.height < MIN_SIDE_HEIGHT || s.width >= m.width) continue
      if (s.left >= m.right - 1 && s.top < m.bottom && s.bottom > m.top) {
        return { container, main, side: side as HTMLElement }
      }
    }
  }
  return undefined
}
