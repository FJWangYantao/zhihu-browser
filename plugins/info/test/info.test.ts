import {
  type ContentTarget,
  createHost,
  createMemorySettingsBackend,
  createMemoryStorageBackend,
} from '@zhihu-browser/core'
import type { Answer, Content, Dispose, ItemUI } from '@zhihu-browser/sdk'
import { describe, expect, test } from 'vitest'
import * as infoPlugin from '../src/index'
import { badgesFor, formatDate, formatRelative, formatWords, type InfoOptions } from '../src/index'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

// 2023-11-14 22:13:20（北京时间 2023-11-15 06:13:20）
const T0 = 1_700_000_000_000
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const defaults: InfoOptions = { showCreated: true, showUpdated: true, timeFormat: 'datetime', showWordCount: true }

function answer(overrides: Partial<Answer> = {}): Answer {
  return {
    type: 'answer',
    id: '1',
    url: 'https://www.zhihu.com/question/9/answer/1',
    title: '一个问题',
    question: { id: '9', title: '一个问题' },
    createdAt: T0,
    updatedAt: T0 + 3 * DAY,
    wordCount: 1234,
    ...overrides,
  }
}

describe('格式', () => {
  test('日期和时间按本地时区', () => {
    expect(formatDate(T0, 'date')).toBe('2023-11-15')
    expect(formatDate(T0)).toBe('2023-11-15 06:13')
    expect(formatDate(T0, 'second')).toBe('2023-11-15 06:13:20')
  })

  test('多久以前', () => {
    expect(formatRelative(T0, T0 + 30_000)).toBe('刚刚')
    expect(formatRelative(T0, T0 + 5 * MINUTE)).toBe('5 分钟前')
    expect(formatRelative(T0, T0 + 3 * 60 * MINUTE)).toBe('3 小时前')
    expect(formatRelative(T0, T0 + 2 * DAY)).toBe('2 天前')
    expect(formatRelative(T0, T0 + 65 * DAY)).toBe('2 个月前')
    expect(formatRelative(T0, T0 + 330 * DAY)).toBe('11 个月前')
    expect(formatRelative(T0, T0 + 800 * DAY)).toBe('2 年前')
    // 时钟不准（内容时间比现在还晚）时不出现负数
    expect(formatRelative(T0 + DAY, T0)).toBe('刚刚')
  })

  test('字数', () => {
    expect(formatWords(9999)).toBe('9999 字')
    expect(formatWords(12_345)).toBe('1.2 万字')
    expect(formatWords(20_000)).toBe('2 万字')
  })
})

describe('标签', () => {
  test('回答：发布时间、编辑时间和字数', () => {
    expect(badgesFor(answer(), defaults, T0)).toEqual([
      { text: '发布于 2023-11-15 06:13', title: '发布于 2023-11-15 06:13:20' },
      { text: '编辑于 2023-11-18 06:13', title: '编辑于 2023-11-18 06:13:20' },
      { text: '1234 字', title: '约 3 分钟读完（按每分钟 400 字估算）' },
    ])
  })

  test('只写日期、多久以前', () => {
    expect(badgesFor(answer(), { ...defaults, timeFormat: 'date' }, T0).map(b => b.text)).toEqual([
      '发布于 2023-11-15',
      '编辑于 2023-11-18',
      '1234 字',
    ])
    expect(badgesFor(answer(), { ...defaults, timeFormat: 'relative' }, T0 + 10 * DAY).map(b => b.text)).toEqual([
      '发布于 10 天前',
      '编辑于 7 天前',
      '1234 字',
    ])
  })

  test('发布后一分钟以内的修改不算编辑；没有的信息不显示', () => {
    expect(badgesFor(answer({ updatedAt: T0 + 30_000 }), defaults, T0).map(b => b.text)).toEqual([
      '发布于 2023-11-15 06:13',
      '1234 字',
    ])
    const bare: Content = { type: 'answer', id: '2', url: '', title: '', question: { id: '9', title: '' } }
    expect(badgesFor(bare, defaults, T0)).toEqual([])
  })

  test('问题显示提问时间，不显示编辑时间；想法没有字数', () => {
    const question: Content = { type: 'question', id: '9', url: '', title: '问题', createdAt: T0, updatedAt: T0 + DAY }
    expect(badgesFor(question, defaults, T0).map(b => b.text)).toEqual(['提问于 2023-11-15 06:13'])
    const pin: Content = { type: 'pin', id: 'p', url: '', title: '', createdAt: T0 }
    expect(badgesFor(pin, defaults, T0).map(b => b.text)).toEqual(['发布于 2023-11-15 06:13'])
  })

  test('可以分别关掉', () => {
    expect(badgesFor(answer(), { ...defaults, showCreated: false, showWordCount: false }, T0).map(b => b.text)).toEqual(
      ['编辑于 2023-11-18 06:13'],
    )
    expect(badgesFor(answer(), { ...defaults, showUpdated: false, showWordCount: false }, T0).map(b => b.text)).toEqual(
      ['发布于 2023-11-15 06:13'],
    )
  })
})

describe('插件', () => {
  async function setup(settings: Record<string, unknown> = {}) {
    const backend = createMemorySettingsBackend({ info: settings })
    const host = createHost({
      services: {
        settings: backend,
        storage: createMemoryStorageBackend(),
        fetch: async () => {
          throw new Error('不访问网络')
        },
        ui: { toast() {}, confirm: async () => true, mount: () => () => {} },
        addStyle: () => () => {},
        contents: { all: () => [], current: () => undefined },
        log: () => {},
      },
    })
    await host.load(infoPlugin)

    /** 模拟适配层给一块内容提供的界面工具，记录插件加的标签 */
    function show(content: Content) {
      const controller = new AbortController()
      const badges: { text: string; tone?: string; title?: string }[] = []
      const ui: ItemUI = {
        badge(text, options) {
          const badge = { text, ...options }
          badges.push(badge)
          return (() => badges.splice(badges.indexOf(badge), 1)) as Dispose
        },
        fold: () => () => {},
        addAction: () => () => {},
        mount: () => () => {},
      }
      const target: ContentTarget = {
        el: {} as HTMLElement,
        ui,
        signal: controller.signal,
        handle: { data: content, expand() {}, collapse() {}, scrollIntoView() {}, isVisible: () => true },
      }
      host.addContent(content, target)
      return { badges, remove: () => controller.abort() }
    }

    return {
      host,
      show,
      update: async (values: Record<string, unknown>) => {
        backend.update('info', { ...backend.peek('info'), ...values })
        await flush()
      },
    }
  }

  test('在内容上显示灰色的标签，鼠标移上去显示精确到秒的时间', async () => {
    const t = await setup()
    const a = t.show(answer())
    await flush()
    expect(a.badges).toEqual([
      { text: '发布于 2023-11-15 06:13', tone: 'muted', title: '发布于 2023-11-15 06:13:20' },
      { text: '编辑于 2023-11-18 06:13', tone: 'muted', title: '编辑于 2023-11-18 06:13:20' },
      { text: '1234 字', tone: 'muted', title: '约 3 分钟读完（按每分钟 400 字估算）' },
    ])
  })

  test('设置变化后重新显示；被移除的内容不再更新；停用后撤销', async () => {
    const t = await setup()
    const a = t.show(answer())
    const b = t.show(answer({ id: '2' }))
    await flush()
    await t.update({ timeFormat: 'date', showWordCount: false })
    expect(a.badges.map(x => x.text)).toEqual(['发布于 2023-11-15', '编辑于 2023-11-18'])
    b.remove()
    await t.update({ showUpdated: false })
    expect(a.badges.map(x => x.text)).toEqual(['发布于 2023-11-15'])
    expect(b.badges.map(x => x.text)).toEqual(['发布于 2023-11-15', '编辑于 2023-11-18'])
    t.host.disable('info')
    expect(a.badges).toEqual([])
  })
})
