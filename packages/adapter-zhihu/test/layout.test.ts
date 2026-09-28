import { afterEach, describe, expect, test } from 'vitest'
import { findColumns } from '../src/dom/layout'
import { html } from './page'

afterEach(() => {
  document.body.replaceChildren()
})

/** happy-dom 不排版：手动给元素指定位置（左、上、宽、高） */
function place(el: Element | null, x: number, y: number, width: number, height: number): void {
  if (!el) throw new Error('找不到元素')
  el.getBoundingClientRect = () =>
    ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height }) as DOMRect
}

/** 两栏布局：主栏包在一层没有类名的元素里，右侧栏只有自动生成的类名 */
function layout(): HTMLElement {
  const page = html(`
    <div class="Topstory-container">
      <div class="wrap"><div class="Topstory-mainColumn"><div class="ContentItem">内容</div></div></div>
      <div class="css-1qyytj7">右侧栏</div>
    </div>`)
  document.body.append(page)
  place(page, 0, 0, 1000, 2000)
  for (const selector of ['.wrap', '.Topstory-mainColumn', '.ContentItem'])
    place(page.querySelector(selector), 0, 0, 694, 2000)
  place(page.querySelector('.ContentItem'), 0, 0, 694, 300)
  place(page.querySelector('.css-1qyytj7'), 704, 0, 296, 900)
  return page
}

describe('按位置找两栏布局', () => {
  test('右侧栏在主栏右边、上下有重叠，不看类名', () => {
    const page = layout()
    const columns = findColumns(page.querySelector('.ContentItem') as HTMLElement)
    expect(columns?.container).toBe(page)
    expect(columns?.main.className).toBe('wrap')
    expect(columns?.side.className).toBe('css-1qyytj7')
  })

  test('太小的元素、在下面的元素、比主栏宽的元素都不算右侧栏', () => {
    const page = layout()
    const side = page.querySelector('.css-1qyytj7')
    const content = page.querySelector('.ContentItem') as HTMLElement
    place(side, 704, 0, 40, 40)
    expect(findColumns(content)).toBeUndefined()
    // 在右边但上下没有重叠（在主栏下面）
    place(side, 704, 2100, 296, 900)
    expect(findColumns(content)).toBeUndefined()
    place(side, 704, 0, 800, 900)
    expect(findColumns(content)).toBeUndefined()
    // 贴着主栏的右边也算
    place(side, 693.5, 0, 296, 900)
    expect(findColumns(content)?.side).toBe(side)
  })

  test('没有排版（宽度为 0）的层跳过；不把 body 当成外框', () => {
    const page = layout()
    place(page.querySelector('.Topstory-mainColumn'), 0, 0, 0, 0)
    expect(findColumns(page.querySelector('.ContentItem') as HTMLElement)?.main.className).toBe('wrap')
    const lone = html('<div class="ContentItem">单独的内容</div>')
    document.body.append(lone, html('<div class="aside">旁边</div>'))
    place(lone, 0, 0, 600, 300)
    place(document.body.lastElementChild, 610, 0, 300, 300)
    expect(findColumns(lone)).toBeUndefined()
  })
})
