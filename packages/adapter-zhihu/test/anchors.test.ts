import { describe, expect, test } from 'vitest'
import { isContentElement } from '../src/dom/anchors'
import { html } from './page'

describe('isContentElement', () => {
  test('回答、文章、想法（有 data-zop）、热榜条目是内容', () => {
    document.body.replaceChildren(
      html(`<div class="ContentItem AnswerItem" data-zop='{"itemId":1,"type":"answer"}'></div>`),
      html(`<div class="ContentItem PinItem" data-zop='{"itemId":2,"type":"pin"}'></div>`),
      html('<section class="HotItem"></section>'),
    )
    for (const el of document.body.children) expect(isContentElement(el)).toBe(true)
  })

  test('嵌套在另一块内容里的不算', () => {
    const outer = html(
      `<div class="ContentItem" data-zop='{"itemId":1,"type":"answer"}'><div class="ContentItem"></div></div>`,
    )
    document.body.replaceChildren(outer)
    expect(isContentElement(outer)).toBe(true)
    expect(isContentElement(outer.firstElementChild as Element)).toBe(false)
  })

  test('用户主页动态流里的圆桌活动卡片（没有 data-zop、标题是 RoundTableLink）不是内容', () => {
    const card = html(
      '<div class="ContentItem"><h2 class="ContentItem-title"><a class="RoundTableLink" href="/roundtable/1">圆桌</a></h2></div>',
    )
    document.body.replaceChildren(card)
    expect(isContentElement(card)).toBe(false)
  })

  test('没有 data-zop 但标题是普通链接的卡片（如搜索结果）仍然是内容', () => {
    const card = html(
      '<div class="ContentItem"><h2 class="ContentItem-title"><a href="/question/1">标题</a></h2></div>',
    )
    document.body.replaceChildren(card)
    expect(isContentElement(card)).toBe(true)
  })
})
