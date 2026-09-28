import {
  type ContentTarget,
  createHost,
  createMemorySettingsBackend,
  createMemoryStorageBackend,
} from '@zhihu-browser/core'
import type { Answer, Comment, Content, Dispose, FeedItem, ItemUI, PageInfo, Pin, Video } from '@zhihu-browser/sdk'
import { describe, expect, test } from 'vitest'
import * as filterPlugin from '../src/index'
import { compileAuthors, compileKeywords, matchAuthor } from '../src/index'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const page = (type: PageInfo['type'], params: Record<string, string> = {}): PageInfo => ({
  type,
  url: `https://www.zhihu.com/${type}`,
  params,
})

function answer(id: string, overrides: Partial<Answer> = {}): Answer {
  return {
    type: 'answer',
    id,
    url: `https://www.zhihu.com/question/9/answer/${id}`,
    title: '一个问题',
    excerpt: '摘要',
    author: { id: `u${id}`, urlToken: `user-${id}`, name: `用户${id}` },
    question: { id: '9', title: '一个问题' },
    ...overrides,
  }
}

async function setup(settings: Record<string, unknown> = {}, confirmResult = true) {
  const backend = createMemorySettingsBackend({ filter: settings })
  const toasts: string[] = []
  const confirms: string[] = []
  const host = createHost({
    services: {
      settings: backend,
      storage: createMemoryStorageBackend(),
      fetch: async () => {
        throw new Error('不访问网络')
      },
      ui: {
        toast: message => {
          toasts.push(message)
        },
        confirm: async message => {
          confirms.push(message)
          return confirmResult
        },
        mount: () => () => {},
      },
      addStyle: () => () => {},
      contents: { all: () => [], current: () => undefined },
      log: () => {},
    },
  })
  host.setPage(page('home'))
  await host.load(filterPlugin)

  /** 模拟适配层为一个元素提供的界面工具，记录插件添加的界面 */
  function show(content: Content) {
    const controller = new AbortController()
    const folds = new Set<string>()
    const actions: { label: string; onClick: () => void }[] = []
    const track = <T>(set: Set<T> | T[], value: T): Dispose => {
      if (set instanceof Set) set.add(value)
      else set.push(value)
      return () => {
        if (set instanceof Set) set.delete(value)
        else set.splice(set.indexOf(value), 1)
      }
    }
    const ui: ItemUI = {
      badge: () => () => {},
      fold: reason => track(folds, reason),
      addAction: action => track(actions, action),
      mount: () => () => {},
    }
    const target: ContentTarget = {
      el: {} as HTMLElement,
      ui,
      signal: controller.signal,
      handle: { data: content, expand() {}, collapse() {}, scrollIntoView() {}, isVisible: () => true },
    }
    host.addContent(content, target)
    return { folds, actions, remove: () => controller.abort() }
  }

  return {
    host,
    backend,
    toasts,
    confirms,
    show,
    keep: (item: FeedItem) => host.shouldKeep('feed', item),
    keepAnswer: (a: Answer) => host.shouldKeep('answers', a),
    keepComment: (c: Comment) => host.shouldKeep('comments', c),
    update: (values: Record<string, unknown>) => backend.update('filter', { ...backend.peek('filter'), ...values }),
  }
}

describe('规则', () => {
  test('关键词：不区分大小写；/正则/；写法不对的正则忽略', () => {
    const keywords = compileKeywords(['  ', 'AI', '/^如何评价.+$/', '/[/', '/x/g'])
    expect(keywords.map(k => k.label)).toEqual(['AI', '/^如何评价.+$/', '/x/g'])
    const [ai, regex, global] = keywords
    expect(ai?.test('聊聊 ai 绘画', '聊聊 ai 绘画')).toBe(true)
    expect(regex?.test('如何评价某部电影', '如何评价某部电影')).toBe(true)
    // 去掉了 g 标志：连续调用结果一致
    expect([global?.test('x', 'x'), global?.test('x', 'x')]).toEqual([true, true])
  })

  test('作者：用户名，或带个人主页标识', () => {
    const rules = compileAuthors(['张三', '李四 @li-si', '@wang.wu', ' '])
    expect(rules).toEqual([
      { label: '张三', name: '张三' },
      { label: '李四', urlToken: 'li-si' },
      { label: 'wang.wu', urlToken: 'wang.wu' },
    ])
    expect(matchAuthor({ id: '1', name: '张三' }, rules)?.label).toBe('张三')
    // 改了名也能认出来
    expect(matchAuthor({ id: '2', name: '李四改名了', urlToken: 'li-si' }, rules)?.label).toBe('李四')
    // 同名的另一个人（个人主页标识不同）不受影响
    expect(matchAuthor({ id: '3', name: '李四', urlToken: 'another' }, rules)).toBeUndefined()
    expect(matchAuthor(undefined, rules)).toBeUndefined()
  })
})

describe('过滤（渲染前）', () => {
  test('默认去掉广告和推广，其他内容在折叠方式下保留', async () => {
    const t = await setup({ keywords: ['营销'] })
    expect(t.keep({ id: 'a', kind: 'ad' })).toBe(false)
    expect(t.keep({ id: 'p', kind: 'promotion' })).toBe(false)
    expect(t.keep({ id: 'c', kind: 'content', content: answer('1', { title: '营销号' }) })).toBe(true)
    expect(t.host.shouldKeep('search', { id: 's', kind: 'ad' })).toBe(false)

    t.update({ hideAds: false })
    await flush()
    expect(t.keep({ id: 'a', kind: 'ad' })).toBe(true)
  })

  test('直接去掉：关键词、作者、视频、想法、付费内容', async () => {
    const t = await setup({
      mode: 'remove',
      keywords: ['营销'],
      authors: ['用户2'],
      hideVideos: true,
      hidePins: true,
      hidePaid: true,
    })
    const video: Video = { type: 'video', id: 'v', url: '', title: '视频' }
    const pin: Pin = { type: 'pin', id: 'p', url: '', title: '', text: '营销' }
    expect(t.keep({ id: '1', kind: 'content', content: answer('1') })).toBe(true)
    expect(t.keep({ id: '2', kind: 'content', content: answer('1', { excerpt: '某营销号' }) })).toBe(false)
    expect(t.keepAnswer(answer('2'))).toBe(false)
    expect(t.keep({ id: '3', kind: 'content', content: video })).toBe(false)
    expect(t.keep({ id: '4', kind: 'content', content: pin })).toBe(false)
    expect(t.keep({ id: '5', kind: 'content', content: answer('5', { isPaid: true }) })).toBe(false)
    expect(t.host.shouldKeep('search', { id: 's', kind: 'content', content: answer('2') })).toBe(false)
    expect(t.keep({ id: 'o', kind: 'other' })).toBe(true)
  })

  test('评论：按关键词和作者去掉，可以关闭', async () => {
    const t = await setup({ keywords: ['广告'], authors: ['用户7'] })
    expect(t.keepComment({ id: 'c1', text: '正常评论' })).toBe(true)
    expect(t.keepComment({ id: 'c2', text: '这是广告' })).toBe(false)
    expect(t.keepComment({ id: 'c3', text: '正常', author: { id: '7', name: '用户7' } })).toBe(false)
    t.update({ filterComments: false })
    await flush()
    expect(t.keepComment({ id: 'c2', text: '这是广告' })).toBe(true)
  })
})

describe('折叠并显示原因', () => {
  test('折叠命中的内容，原因写清楚', async () => {
    const t = await setup({ keywords: ['营销'], authors: ['用户2'] })
    const a = t.show(answer('1', { title: '营销号的话术' }))
    const b = t.show(answer('2'))
    const c = t.show(answer('3'))
    await flush()
    expect([...a.folds]).toEqual(['关键词 营销'])
    expect([...b.folds]).toEqual(['作者 用户2'])
    expect([...c.folds]).toEqual([])
  })

  test('设置变化后重新判断：新命中的折叠，不再命中的展开', async () => {
    const t = await setup({ keywords: ['营销'] })
    const a = t.show(answer('1', { title: '营销号' }))
    const b = t.show(answer('2', { title: '电影' }))
    await flush()
    t.update({ keywords: ['电影'] })
    await flush()
    expect([...a.folds]).toEqual([])
    expect([...b.folds]).toEqual(['关键词 电影'])
    // 换成直接去掉：交给过滤函数，不再折叠
    t.update({ mode: 'remove' })
    await flush()
    expect([...b.folds]).toEqual([])
    expect(t.keep({ id: 'x', kind: 'content', content: answer('2', { title: '电影' }) })).toBe(false)
  })

  test('用户专门打开的回答、用户主页上的内容不折叠', async () => {
    const t = await setup({ authors: ['用户1'] })
    t.host.setPage(page('answer', { questionId: '9', answerId: '1' }))
    const opened = t.show(answer('1'))
    const other = t.show(answer('1', { id: '8' }))
    t.host.setPage(page('people', { urlToken: 'user-1' }))
    const profile = t.show(answer('1', { id: '6' }))
    await flush()
    expect([...opened.folds]).toEqual([])
    expect([...other.folds]).toEqual(['作者 用户1'])
    expect([...profile.folds]).toEqual([])
  })
})

describe('屏蔽作者按钮', () => {
  test('确认后记下用户名和个人主页标识，已显示的内容随即折叠', async () => {
    const t = await setup()
    const a = t.show(answer('1'))
    const b = t.show(answer('1', { id: '11' }))
    await flush()
    expect(a.actions.map(x => x.label)).toEqual(['屏蔽作者'])
    a.actions[0]?.onClick()
    await flush()
    expect(t.confirms[0]).toContain('屏蔽 用户1 的所有内容')
    expect(t.backend.peek('filter')?.authors).toEqual(['用户1 @user-1'])
    expect(t.toasts).toEqual(['已屏蔽 用户1'])
    expect([...b.folds]).toEqual(['作者 用户1'])
    // 已经屏蔽的作者不再显示按钮
    expect(b.actions).toEqual([])
  })

  test('取消时不改设置；匿名用户和关闭按钮时不显示', async () => {
    const t = await setup({}, false)
    const a = t.show(answer('1'))
    const anonymous = t.show(answer('2', { author: { id: '0', name: '匿名用户', isAnonymous: true } }))
    await flush()
    a.actions[0]?.onClick()
    await flush()
    expect(t.backend.peek('filter')?.authors ?? []).toEqual([])
    expect(anonymous.actions).toEqual([])
    t.update({ showBlockButton: false })
    await flush()
    expect(a.actions).toEqual([])
  })

  test('内容被移除后不再更新', async () => {
    const t = await setup()
    const a = t.show(answer('1'))
    await flush()
    a.remove()
    t.update({ authors: ['用户1'] })
    await flush()
    expect([...a.folds]).toEqual([])
  })
})
