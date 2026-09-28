import { afterEach, describe, expect, test, vi } from 'vitest'
import { describeElement, describePage } from '../src/diagnose'
import { feedCard, flush, html, type Setup, setup } from './page'

let s: Setup | undefined
afterEach(() => {
  s?.dispose()
  s = undefined
})

describe('页面结构诊断', () => {
  test('元素只写标签名、短的英文 id、类名和我们的标记名', () => {
    const el = html(
      '<div id="Popover12-toggle" class="Card css-1qyytj7 bad!class" data-zb-id="answer:123" data-za-detail="x" title="标题">文字</div>',
    )
    expect(describeElement(el)).toBe('div.Card.css-1qyytj7[data-zb-id]')
    expect(describeElement(html('<main id="root"></main>'))).toBe('main#root')
  })

  test('列出锚点命中数和从内容往上的结构，不含文字、链接和内容 id', async () => {
    s = await setup()
    s.root.append(
      html(
        `<div class="Topstory-container"><div class="Topstory-mainColumn">${feedCard('answer', '1234567', { title: '一个很私密的标题', author: '某用户' })}</div><div class="css-1qyytj7">右侧栏的文字</div></div>`,
      ),
    )
    await flush()
    const report = s.adapter.describe('0.1.0')
    expect(report).toContain('扩展版本：0.1.0 · 页面类型：home')
    expect(report).toContain('  .ContentItem  1\n')
    expect(report).toContain('  .GlobalSideBar  0\n')
    // 从 body 往下只展开包含内容的一支，兄弟元素（右侧栏）列一行
    expect(report).toMatch(/▶ div#root/)
    expect(report).toMatch(/ {4}▶ div\.Topstory-container/)
    expect(report).toMatch(/ {6}· div\.css-1qyytj7 /)
    // 内容本身在主结构里只列一行，内部结构单独列
    expect(report).toMatch(/ {10}· div\.ContentItem\.AnswerItem\[data-zb-id\]\[data-zb-done\] {2}/)
    expect(report).not.toMatch(/▶ div\.ContentItem/)
    expect(report).toMatch(/第一块内容（div\.ContentItem\.AnswerItem\[data-zb-id\]\[data-zb-done\]）的内部结构/)
    expect(report).toMatch(/h2\.ContentItem-title/)
    for (const secret of ['一个很私密的标题', '某用户', '右侧栏的文字', '1234567', 'zhihu.com', 'user-1']) {
      expect(report).not.toContain(secret)
    }
  })

  test('兄弟元素太多时只列出一部分', async () => {
    s = await setup()
    const many = Array.from({ length: 15 }, (_, i) => `<div class="item-${i}"></div>`).join('')
    s.root.append(html(`<div class="list">${many}${feedCard('answer', '1')}</div>`))
    await flush()
    const report = s.adapter.describe()
    expect(report).toContain('div.item-11')
    expect(report).not.toContain('div.item-12')
    expect(report).toContain('…另有 3 个')
    // 包含内容的一支总是列出来
    expect(report).toMatch(/▶ div\.Card\.TopstoryItem/)
  })

  test('暗色时：列出补丁改了多少、另外设置了 data-theme 的元素、仍然看不清的文字和白色块', () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    const style = html(
      '<style>body { background-color: #121212; } .t { color: #121212; } .w { background-color: #ffffff; }</style>',
    )
    document.head.append(style)
    document.documentElement.setAttribute('data-theme', 'dark')
    document.body.append(
      html(
        '<div class="CommentBox"><div data-theme="light" class="css-x"><span class="t">看不清的名字</span></div><div class="w css-chip">白块</div></div>',
      ),
    )
    const report = describePage(document, { page: { type: 'question', url: 'https://www.zhihu.com/', params: {} } })
    expect(report).toContain('暗色补丁改了：背景 0 个、文字 0 个、边框 0 个')
    expect(report).toContain('页面里另外设置了 data-theme 的元素：1 个\n    · div.css-x data-theme="light"')
    expect(report).toMatch(/仍然看不清的文字：\n {4}· span\.t < div\.css-x < div\.CommentBox {2}文字 /)
    expect(report).toMatch(/暗色背景上仍然是浅色的块：\n {4}· div\.w\.css-chip < div\.CommentBox < body {2}背景 /)
    expect(report).not.toContain('看不清的名字')
    document.documentElement.removeAttribute('data-theme')
    style.remove()
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  test('页面上没有内容时说明', () => {
    document.body.append(html('<div class="x"></div>'))
    const report = describePage(document, { page: { type: 'other', url: 'https://www.zhihu.com/', params: {} } })
    expect(report).toContain('页面上没有找到内容')
    expect(report).toContain('扩展版本：未知')
    document.body.replaceChildren()
  })
})
