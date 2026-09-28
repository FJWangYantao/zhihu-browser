import { createHost, createMemorySettingsBackend, createMemoryStorageBackend } from '@zhihu-browser/core'
import type { Answer, ContentHandle } from '@zhihu-browser/sdk'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as shortcutsPlugin from '../src/index'
import { CHAIN_MS } from '../src/index'

function answer(id: string): Answer {
  return {
    type: 'answer',
    id,
    url: `https://www.zhihu.com/question/9/answer/${id}`,
    title: '一个问题',
    question: { id: '9', title: '一个问题' },
  }
}

let log: string[]
let handles: ContentHandle[]
/** 视口最上面的内容（下标）；undefined 表示视口里没有内容 */
let top: number | undefined
const scrollTo = vi.fn()

function handle(id: string): ContentHandle {
  return {
    data: answer(id),
    expand: () => log.push(`expand:${id}`),
    collapse: () => log.push(`collapse:${id}`),
    scrollIntoView: () => log.push(`scroll:${id}`),
    isVisible: () => true,
  }
}

async function setup() {
  const host = createHost({
    services: {
      settings: createMemorySettingsBackend(),
      storage: createMemoryStorageBackend(),
      fetch: async () => {
        throw new Error('不访问网络')
      },
      ui: { toast() {}, confirm: async () => true, mount: () => () => {} },
      addStyle: () => () => {},
      contents: { all: () => [...handles], current: () => (top === undefined ? undefined : handles[top]) },
      log: () => {},
    },
  })
  host.setPage({ type: 'question', url: 'https://www.zhihu.com/question/9', params: { questionId: '9' } })
  await host.load(shortcutsPlugin)
  const press = (...strokes: string[]) => {
    for (const stroke of strokes) host.handleKey(stroke)
  }
  return { host, press }
}

beforeEach(() => {
  log = []
  handles = ['1', '2', '3', '4'].map(handle)
  top = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.stubGlobal('window', { scrollTo })
  scrollTo.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('切换内容', () => {
  test('j / k：以视口最上面的内容为准，到头了不动', async () => {
    const { press } = await setup()
    press('j')
    expect(log).toEqual(['scroll:2'])
    vi.advanceTimersByTime(CHAIN_MS)
    top = 3
    press('j')
    expect(log).toEqual(['scroll:2'])
    press('k')
    expect(log).toEqual(['scroll:2', 'scroll:3'])
    vi.advanceTimersByTime(CHAIN_MS)
    top = 0
    press('k')
    expect(log).toEqual(['scroll:2', 'scroll:3'])
  })

  test('连续按键时以上一次跳到的内容为准（平滑滚动还没停下）', async () => {
    const { press } = await setup()
    press('j', 'j', 'j')
    expect(log).toEqual(['scroll:2', 'scroll:3', 'scroll:4'])
    press('k')
    expect(log.at(-1)).toBe('scroll:3')
    // 停了一会儿，用户可能自己滚动过：重新以视口为准
    vi.advanceTimersByTime(CHAIN_MS)
    top = 1
    press('j')
    expect(log.at(-1)).toBe('scroll:3')
  })

  test('跳到的内容不在页面上了：以视口为准', async () => {
    const { press } = await setup()
    press('j')
    handles = handles.filter(h => h.data.id !== '2')
    top = 1
    press('j')
    expect(log).toEqual(['scroll:2', 'scroll:4'])
  })

  test('视口里没有内容（滚过了全部内容）：往上翻回到最后一块，往下不动', async () => {
    const { press } = await setup()
    top = undefined
    press('j')
    expect(log).toEqual([])
    press('k')
    expect(log).toEqual(['scroll:4'])
  })

  test('页面上没有内容时什么也不做', async () => {
    const { press } = await setup()
    handles = []
    top = undefined
    press('j', 'k', 'o', 'c', 'shift+c')
    expect(log).toEqual([])
  })
})

describe('展开、收起、回到顶部', () => {
  test('o 展开当前内容；c 收起并把它放回视口顶部', async () => {
    const { press } = await setup()
    top = 1
    press('o')
    expect(log).toEqual(['expand:2'])
    press('c')
    expect(log).toEqual(['expand:2', 'collapse:2', 'scroll:2'])
  })

  test('刚用 j 跳到的内容就是当前内容', async () => {
    const { press } = await setup()
    press('j', 'o')
    expect(log).toEqual(['scroll:2', 'expand:2'])
  })

  test('Shift+C 收起全部内容，停在当前内容上', async () => {
    const { press } = await setup()
    top = 2
    press('shift+c')
    expect(log).toEqual(['collapse:1', 'collapse:2', 'collapse:3', 'collapse:4', 'scroll:3'])
  })

  test('g g 回到顶部', async () => {
    const { press } = await setup()
    press('j', 'g')
    expect(scrollTo).not.toHaveBeenCalled()
    press('g')
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    // 回到顶部后重新以视口为准
    press('j')
    expect(log).toEqual(['scroll:2', 'scroll:2'])
  })
})

describe('注册', () => {
  test('快捷键和命令一一对应，标题相同', async () => {
    const { host } = await setup()
    const shortcuts = host.shortcuts().map(s => [s.keys, s.description])
    expect(shortcuts).toEqual([
      ['j', '下一条内容'],
      ['k', '上一条内容'],
      ['o', '展开当前内容'],
      ['c', '收起当前内容'],
      ['shift+c', '收起全部内容'],
      ['g g', '回到顶部'],
    ])
    expect(host.commands().map(c => c.title)).toEqual(shortcuts.map(([, title]) => title))
    await host.runCommand('shortcuts.next')
    expect(log).toEqual(['scroll:2'])
  })
})
