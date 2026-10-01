import type { ContentContext } from '@zhihu-browser/sdk'
import { describe, expect, test } from 'vitest'
import { answer, feedItem, flush, setupRemote, target } from './helpers'

// 用真正的 DOM 事件通道把整条链路跑一遍（其余的测试用内存通道）。
describe('通过 DOM 事件通道运行', () => {
  test('过滤、渲染钩子、页面元素、全局挂载点', async () => {
    let ctx: ContentContext | undefined
    const { host, globalMounts } = await setupRemote({
      dom: 'integration-1',
      entry: z => {
        z.filter('feed', item => item.id !== 'drop')
        z.on('content', (_c, c) => {
          ctx = c
          c.ui.badge('来自 DOM 通道')
        })
        z.ui.mount('overlay', container => {
          container.textContent = '覆盖层'
        })
      },
    })
    expect(host.shouldKeep('feed', feedItem({ id: 'drop' }))).toBe(false)
    expect(host.shouldKeep('feed', feedItem({ id: 'keep' }))).toBe(true)

    const t = target(answer({ id: '3' }))
    document.body.append(t.el)
    host.addContent(t.target.handle.data, t.target)
    await flush()
    expect([...t.decorations]).toEqual(['badge:来自 DOM 通道'])
    expect(ctx?.el).toBe(t.el)
    expect(globalMounts[0]?.container.textContent).toBe('覆盖层')
    t.el.remove()
  })

  test('运行时不在线时同样给出提示', async () => {
    const { info } = await setupRemote({ dom: 'integration-2', entry: () => {}, noRuntime: true })
    expect(info.state).toBe('failed')
  })

  test('两个插件各用各的通道，互不干扰', async () => {
    const a = await setupRemote({ dom: 'chan-a', meta: { id: 'plugin-a' }, entry: z => z.filter('feed', () => false) })
    const b = await setupRemote({ dom: 'chan-b', meta: { id: 'plugin-b' }, entry: () => {} })
    expect(a.host.shouldKeep('feed', feedItem())).toBe(false)
    expect(b.host.shouldKeep('feed', feedItem())).toBe(true)
  })
})
