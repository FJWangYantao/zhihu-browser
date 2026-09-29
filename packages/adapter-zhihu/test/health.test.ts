import { afterEach, describe, expect, test } from 'vitest'
import { type AnchorSpec, checkAnchors } from '../src/health'
import { feedCard, flush, html, plugin, type Setup, setup, sleep } from './page'

const meta = { id: 'p', name: 'p', version: '1.0.0', api: 1 } as const

let s: Setup | undefined
afterEach(() => {
  s?.dispose()
  s = undefined
})

const HOME = { type: 'home' as const, url: 'https://www.zhihu.com/', params: {} }

describe('checkAnchors', () => {
  test('健康的首页：内容锚点和标题锚点都正常', () => {
    document.body.append(html(feedCard('answer', '1')))
    const report = checkAnchors(document, HOME, 'contents')
    expect(report?.failedFeatures).toEqual([])
    expect(report?.anchors).toEqual([
      { selector: '.ContentItem, .HotItem, .QuestionHeader, [data-zop]', matched: 1, expected: '≥1', healthy: true },
      {
        selector: '.ContentItem-title, .HotItem-title, .QuestionHeader-title, .Post-Title',
        matched: 1,
        expected: '≥1',
        healthy: true,
      },
    ])
    document.body.replaceChildren()
  })

  test('知乎改版：内容锚点失配时列出停用的功能', () => {
    document.body.append(html('<div class="css-1qyytj7">改版后的卡片</div>'))
    const report = checkAnchors(document, HOME, 'contents')
    expect(report?.failedFeatures).toEqual(['contents', 'item-ui'])
    expect(report?.anchors.every(a => !a.healthy)).toBe(true)
    document.body.replaceChildren()
  })

  test('没有声明的页面类型不检查', () => {
    for (const type of ['search', 'pin', 'other'] as const)
      expect(checkAnchors(document, { ...HOME, type }, 'contents')).toBeUndefined()
    // 没有声明的检查时机也不检查
    expect(checkAnchors(document, HOME, 'hydrated')).toBeUndefined()
  })

  test('min / max：少于最少、多于最多都算失配', () => {
    const specs: readonly AnchorSpec[] = [
      { selector: '.x', when: 'contents', pages: { home: { min: 2, max: 3 } }, features: ['contents'] },
      { selector: '.y', when: 'contents', pages: { home: { min: 1, max: 1 } }, features: ['item-ui'] },
    ]
    const at = () => checkAnchors(document, HOME, 'contents', specs)
    const anchorsAt = () => at()?.anchors ?? []
    expect(anchorsAt().map(a => [a.matched, a.expected, a.healthy])).toEqual([
      [0, '2–3', false],
      [0, '=1', false],
    ])
    document.body.append(html('<div><i class="x"></i><i class="x"></i><i class="y"></i></div>'))
    expect(anchorsAt().every(a => a.healthy)).toBe(true)
    document.body.append(html('<div><i class="x"></i><i class="x"></i></div>'))
    expect(anchorsAt().map(a => a.healthy)).toEqual([false, true])
    expect(at()?.failedFeatures).toEqual(['contents'])
    document.body.replaceChildren()
  })
})

describe('适配层的健康检查', () => {
  test('健康的页面：不提示，功能不停用', async () => {
    s = await setup({ healthDelayMs: 10 })
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    await sleep(30)
    expect(document.querySelector('.zb-health-notice')).toBeNull()
    expect(s.adapter.health().disabledFeatures).toEqual([])
    expect(s.adapter.health().anchors.every(a => a.healthy)).toBe(true)
  })

  test('锚点失配：停用功能、放行页面、角落提示，诊断里有健康检查', async () => {
    s = await setup({ healthDelayMs: 10 })
    s.root.append(html('<div class="css-1qyytj7">知乎改版后的卡片</div>'))
    await flush()
    await sleep(30)
    expect(s.adapter.health().disabledFeatures).toEqual(['contents', 'item-ui'])
    // 放行：预隐藏撤下，页面照常可用
    expect(document.documentElement.hasAttribute('data-zb-prehide')).toBe(false)
    const notice = document.querySelector<HTMLElement>('.zb-health-notice')
    expect(notice?.textContent).toContain('知乎页面结构可能已变化')
    expect(notice?.textContent).toContain('内容识别')
    expect(notice?.textContent).toContain('内容上的界面')
    // 诊断信息里能看到健康检查的结果
    const report = s.adapter.describe('0.1.0')
    expect(report).toContain('健康检查')
    expect(report).toContain('已停用的功能：内容识别、内容上的界面')
  })

  test('恢复：内容出现后自动重新启用并补扫', async () => {
    const seen: string[] = []
    s = await setup({
      healthDelayMs: 10,
      plugins: [
        plugin(meta, z => {
          z.on('content', (c, ctx) => {
            seen.push(c.id)
            ctx.ui.badge('标签')
          })
        }),
      ],
    })
    await sleep(30)
    expect(document.querySelector('.zb-health-notice')).not.toBeNull()
    s.root.append(html(feedCard('answer', '1')))
    await sleep(30)
    expect(s.adapter.health().disabledFeatures).toEqual([])
    expect(document.querySelector('.zb-health-notice')).toBeNull()
    expect(document.querySelector('.ContentItem')?.getAttribute('data-zb-id')).toBe('answer:1')
    expect(seen).toEqual(['1'])
    expect(document.querySelector('.zb-badge')?.textContent).toBe('标签')
  })

  test('界面锚点失配：插件拿到的界面工具什么也不做', async () => {
    const seen: string[] = []
    s = await setup({
      healthDelayMs: 10,
      plugins: [
        plugin(meta, z => {
          z.on('content', (c, ctx) => {
            seen.push(c.id)
            ctx.ui.badge('标签')
          })
        }),
      ],
    })
    // 有内容元素但没有标题：内容识别正常，界面停用
    s.root.append(
      html('<div class="ContentItem" data-zop=\'{"itemId":1,"type":"answer","title":"t","authorName":"a"}\'></div>'),
    )
    await flush()
    await sleep(30)
    expect(seen).toEqual(['1'])
    expect(s.adapter.health().disabledFeatures).toEqual(['item-ui'])
    expect(document.querySelector('.zb-badge')).toBeNull()
    expect(document.querySelector('.zb-health-notice')?.textContent).toContain('内容上的界面')
  })

  test('忽略：同类页面不再弹出，功能保持停用', async () => {
    s = await setup({ healthDelayMs: 10 })
    await sleep(30)
    document.querySelector<HTMLElement>('.zb-health-close')?.click()
    expect(document.querySelector('.zb-health-notice')).toBeNull()
    await sleep(30)
    expect(document.querySelector('.zb-health-notice')).toBeNull()
    expect(s.adapter.health().disabledFeatures).toEqual(['contents', 'item-ui'])
  })

  test('路由切换：健康状态按新页面重新检查', async () => {
    s = await setup({ healthDelayMs: 10 })
    await sleep(30)
    // 首页没有内容：失配、有提示
    expect(s.adapter.health().disabledFeatures).toEqual(['contents', 'item-ui'])
    expect(document.querySelector('.zb-health-notice')).not.toBeNull()
    // 切到问题页：问题头在、锚点齐 → 状态重置，提示撤下
    s.root.append(html('<div class="QuestionHeader"><h1 class="QuestionHeader-title">问题</h1></div>'))
    history.pushState(null, '', '/question/9')
    s.send({ type: 'route', url: 'https://www.zhihu.com/question/9' })
    await flush()
    await sleep(30)
    expect(s.adapter.health().page).toBe('question')
    expect(s.adapter.health().disabledFeatures).toEqual([])
    expect(document.querySelector('.zb-health-notice')).toBeNull()
  })
})
