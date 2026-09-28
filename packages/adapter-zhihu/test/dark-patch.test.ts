import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { contrast, type DarkPatch, lightened, luminance, parseColor, startDarkPatch } from '../src/dom/dark-patch'
import { flush, html } from './page'

describe('颜色', () => {
  test('解析计算后的颜色', () => {
    expect(parseColor('rgb(18, 18, 18)')).toEqual([18, 18, 18, 1])
    expect(parseColor('rgba(255, 255, 255, 0.5)')).toEqual([255, 255, 255, 0.5])
    expect(parseColor('rgb(0 128 255 / 50%)')).toEqual([0, 128, 255, 0.5])
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('#12121280')).toEqual([18, 18, 18, 128 / 255])
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0])
    expect(parseColor('oklch(0.5 0.1 200)')).toBeUndefined()
    expect(parseColor('#12345')).toBeUndefined()
    expect(parseColor('rgb(1, 2)')).toBeUndefined()
  })

  test('亮度和对比度', () => {
    expect(luminance([255, 255, 255, 1])).toBeCloseTo(1)
    expect(luminance([0, 0, 0, 1])).toBe(0)
    expect(contrast(1, 0)).toBeCloseTo(21)
    // 知乎浅色主题的正文颜色放在暗色背景上看不清，次要文字的灰色还看得清
    const bg = luminance([18, 18, 18, 1])
    expect(contrast(luminance([18, 18, 18, 1]), bg)).toBeLessThan(3)
    expect(contrast(luminance([133, 144, 166, 1]), bg)).toBeGreaterThan(3)
  })

  test('有颜色的文字改亮时保留色相，灰色用默认的浅灰', () => {
    expect(lightened([18, 18, 18, 1])).toBeUndefined()
    expect(lightened([133, 144, 166, 1])).toBeUndefined()
    expect(lightened([23, 81, 153, 1])).toBe('hsl(213, 74%, 72%)')
    expect(lightened([200, 30, 30, 1])).toBe('hsl(0, 74%, 72%)')
  })
})

describe('暗色补丁', () => {
  let patch: DarkPatch | undefined
  let style: HTMLStyleElement

  beforeEach(() => {
    // happy-dom 不排版：给所有元素一个尺寸
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 100,
      height: 40,
      right: 100,
      bottom: 40,
    } as DOMRect)
    style = html(`<style>
      body { background-color: #121212; color: #d3d3d3; }
      .white { background-color: #ffffff; }
      .dark-text { color: #121212; }
      .grey-text { color: #8590a6; }
      .link { color: #175199; }
      .line { border-bottom: 1px solid #ebebeb; }
      .picture { background-image: url(x.png); }
    </style>`) as HTMLStyleElement
    document.head.append(style)
  })

  afterEach(() => {
    patch?.dispose()
    patch = undefined
    style.remove()
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  const marks = (el: Element | null) =>
    ['data-zb-dark-bg', 'data-zb-dark-text', 'data-zb-dark-border'].filter(m => el?.hasAttribute(m))

  test('暗色页面上：白色块、看不清的文字、浅色边框做标记；看得清的不动', () => {
    document.body.append(
      html(`<div id="page">
        <div class="white" id="island">白色块</div>
        <p class="dark-text" id="name">用户名</p>
        <span class="grey-text" id="meta">54 分钟前</span>
        <a class="link" id="link">@某人</a>
        <div class="line" id="line"></div>
        <div class="picture white" id="picture"></div>
        <div class="dark-text" id="empty"><span class="grey-text">只有子元素有文字</span></div>
        <div data-zb-ui><span class="dark-text" id="ours">我们自己的界面</span></div>
        <svg class="white" id="svg"></svg>
      </div>`),
    )
    patch = startDarkPatch(document)
    const $ = (id: string) => document.getElementById(id)
    expect(marks($('island'))).toEqual(['data-zb-dark-bg'])
    expect(marks($('name'))).toEqual(['data-zb-dark-text'])
    expect(marks($('meta'))).toEqual([])
    expect(marks($('line'))).toEqual(['data-zb-dark-border'])
    // 有背景图片的不改；没有自己文字的元素不改文字颜色；我们自己的界面、svg 不动
    expect(marks($('picture'))).toEqual([])
    expect(marks($('empty'))).toEqual([])
    expect(marks($('ours'))).toEqual([])
    expect(marks($('svg'))).toEqual([])
    // 有颜色的文字保留色相
    expect(marks($('link'))).toEqual(['data-zb-dark-text'])
    expect(($('link') as HTMLElement).style.getPropertyValue('--zb-dark-text')).toBe('hsl(213, 74%, 72%)')
    expect(patch.stats()).toEqual({ bg: 1, text: 2, border: 1 })

    patch.dispose()
    expect(marks($('island'))).toEqual([])
    expect(marks($('name'))).toEqual([])
    expect(($('link') as HTMLElement).style.getPropertyValue('--zb-dark-text')).toBe('')
  })

  test('浅色页面上什么也不改', () => {
    style.textContent += 'body { background-color: #ffffff; color: #121212; }'
    document.body.append(
      html('<div><div class="white">白色块</div><p class="dark-text">文字</p><div class="line"></div></div>'),
    )
    patch = startDarkPatch(document)
    expect(patch.stats()).toEqual({ bg: 0, text: 0, border: 0 })
  })

  test('后来插入的元素在绘制之前处理（加载中的占位、展开的评论）', async () => {
    patch = startDarkPatch(document)
    const skeleton = html('<div class="white"><p class="dark-text">加载中</p></div>')
    document.body.append(skeleton)
    await Promise.resolve()
    expect(marks(skeleton)).toEqual(['data-zb-dark-bg'])
  })

  test('class 变了重新检查：不再需要的标记去掉', async () => {
    const item = html('<p class="dark-text">文字</p>')
    document.body.append(item)
    patch = startDarkPatch(document)
    expect(marks(item)).toEqual(['data-zb-dark-text'])
    item.className = 'grey-text'
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(marks(item)).toEqual([])
    await flush()
  })
})
