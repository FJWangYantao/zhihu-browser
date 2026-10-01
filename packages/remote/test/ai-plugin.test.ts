import { describe, expect, test } from 'vitest'
import * as example from '../../../docs/examples/low-vote-fold'
import { answer, flush, setupRemote, target } from './helpers'

// docs/examples/low-vote-fold.ts 是一个只读了《给 AI 的指南》的 AI 按需求写出来的插件。
// 这里作为用户插件（跨环境）跑一遍，逐条验证需求：这是"借助 AI 写出并运行一个插件"的实际检验。
describe('AI 按指南写出的插件（低赞回答折叠）', () => {
  async function run(settings: Record<string, unknown> = {}) {
    const setup = await setupRemote({ entry: example.default as never, meta: example.meta as never, settings })
    const low = target(answer({ id: 'low', voteupCount: 3, commentCount: 1 }))
    const high = target(answer({ id: 'high', voteupCount: 50, commentCount: 7 }))
    const missing = target(answer({ id: 'missing' }))
    for (const t of [low, high, missing]) setup.host.addContent(t.handle.data as never, t.target)
    await flush()
    return { ...setup, low, high, missing }
  }

  test('1. 标签显示"赞 · 评"，缺失的按 0 处理', async () => {
    const { low, high, missing } = await run()
    expect([...low.decorations]).toContain('badge:赞 3 · 评 1:muted')
    expect([...high.decorations]).toContain('badge:赞 50 · 评 7:muted')
    expect([...missing.decorations]).toContain('badge:赞 0 · 评 0:muted')
  })

  test('2. 低于阈值的折叠并写明原因，不低的不折叠', async () => {
    const { low, high, missing } = await run()
    expect([...low.decorations]).toContain('fold:赞同数低于 10')
    expect([...missing.decorations]).toContain('fold:赞同数低于 10')
    expect([...high.decorations].some(d => d.startsWith('fold:'))).toBe(false)
  })

  test('3. 关掉开关不折叠，但标签照常显示', async () => {
    const { low } = await run({ foldLow: false })
    expect([...low.decorations]).toEqual(['badge:赞 3 · 评 1:muted'])
  })

  test('4. 命令撤销当前页面上的折叠', async () => {
    const { host, low, high, toasts } = await run()
    await host.runCommand('low-vote-fold.expand-low')
    await flush()
    expect([...low.decorations]).toEqual(['badge:赞 3 · 评 1:muted'])
    expect([...high.decorations]).toEqual(['badge:赞 50 · 评 7:muted'])
    expect(toasts.at(-1)).toBe('已展开 2 个低赞回答')
  })

  test('5. 设置修改后立即更新标签和折叠（阈值、开关）', async () => {
    const { settings, low, high } = await run()
    settings.update('low-vote-fold', { minVotes: 60, foldLow: true })
    await flush()
    expect([...high.decorations]).toContain('fold:赞同数低于 60')
    settings.update('low-vote-fold', { minVotes: 2, foldLow: true })
    await flush()
    expect([...low.decorations]).toEqual(['badge:赞 3 · 评 1:muted'])
    settings.update('low-vote-fold', { minVotes: 2, foldLow: false })
    await flush()
    expect([...high.decorations]).toEqual(['badge:赞 50 · 评 7:muted'])
  })

  test('5b. 命令展开之后，设置再变化会重新判断', async () => {
    const { host, settings, low } = await run()
    await host.runCommand('low-vote-fold.expand-low')
    settings.update('low-vote-fold', { minVotes: 20, foldLow: true })
    await flush()
    expect([...low.decorations]).toContain('fold:赞同数低于 20')
  })

  test('内容被移除后不再跟踪，不会报错', async () => {
    const { host, settings, low, logs } = await run()
    low.remove()
    settings.update('low-vote-fold', { minVotes: 99, foldLow: true })
    await flush()
    await host.runCommand('low-vote-fold.expand-low')
    expect(logs.filter(l => l.level === 'error')).toEqual([])
  })
})
