import type { FeedItem } from '@zhihu-browser/sdk'
import { describe, expect, test } from 'vitest'
import { DATA_API } from '../src/api-urls'
import { classify, processResponse } from '../src/endpoints'
import { ContentStore } from '../src/store'
import {
  apiAnswer,
  apiArticle,
  apiComment,
  initialData,
  moments,
  questionFeeds,
  recommend,
  rootComments,
  search,
} from './fixtures'

const W = 'https://www.zhihu.com'

describe('classify', () => {
  test.each([
    [`${W}/api/v3/feed/topstory/recommend?desktop=true&limit=6`, { kind: 'feed' }],
    [`${W}/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true`, { kind: 'feed' }],
    [`${W}/api/v3/moments?desktop=true&limit=10`, { kind: 'feed' }],
    [`${W}/api/v3/moments/some-user/activities?limit=7`, { kind: 'contents' }],
    [`${W}/api/v4/questions/123/feeds?cursor=x&limit=5`, { kind: 'answers' }],
    [`${W}/api/v4/search_v3?q=x&t=general`, { kind: 'search' }],
    [
      `${W}/api/v4/comment_v5/articles/9/root_comment?limit=10`,
      { kind: 'comments', target: { type: 'article', id: '9' } },
    ],
    [
      `${W}/api/v4/comment_v5/answers/8/root_comment?limit=10`,
      { kind: 'comments', target: { type: 'answer', id: '8' } },
    ],
    [`${W}/api/v4/comment_v5/comment/7/child_comment?limit=20`, { kind: 'comments', rootId: '7' }],
    [`${W}/api/v4/answers/6?include=content`, { kind: 'contents' }],
    ['https://zhuanlan.zhihu.com/api/articles/5/recommendation?limit=12', { kind: 'contents' }],
  ])('%s', (url, expected) => {
    expect(classify(url)).toEqual(expected)
  })

  test.each([
    `${W}/api/v4/me?include=is_realname`,
    `${W}/api/v4/answers/6/relationship?desktop=true`,
    `${W}/api/v4/comment_v5/articles/9/config`,
    'https://api.zhihu.com/v5.1/topics/question/1/relation/v2',
    `${W}/question/1`,
    'https://example.com/api/v3/feed/topstory/recommend',
  ])('不处理 %s', url => {
    // 评论配置接口会被转发，但识别成"其他内容接口"，不会被过滤
    const endpoint = classify(url)
    if (DATA_API.test(url)) expect(endpoint).toEqual({ kind: 'contents' })
    else expect(endpoint).toBeUndefined()
  })
})

const titles = (json: Record<string, unknown>) =>
  (json.data as { target: { question?: { title: string }; title?: string } }[]).map(
    x => x.target.question?.title ?? x.target.title,
  )

describe('processResponse', () => {
  test('没有过滤函数时只存数据，不改动', () => {
    const store = new ContentStore()
    const json = recommend([apiAnswer('1'), apiArticle('2')])
    const before = JSON.stringify(json)
    expect(processResponse(json, { kind: 'feed' }, store, {})).toEqual({ changed: false, removed: 0, folded: 0 })
    expect(JSON.stringify(json)).toBe(before)
    expect(store.content('answer:1')).toMatchObject({ title: '一个问题' })
    expect(store.feedItem('article:2')).toMatchObject({ id: 'feed-1', kind: 'content' })
  })

  test('去掉被过滤的条目，其他字段原样保留', () => {
    const store = new ContentStore()
    const json = recommend([apiAnswer('1'), apiArticle('2'), apiAnswer('3', { question: { id: '9', title: '保留' } })])
    const seen: FeedItem[] = []
    const result = processResponse(json, { kind: 'feed' }, store, {
      feed: item => {
        seen.push(item)
        return item.content?.type !== 'article'
      },
    })
    expect(result).toEqual({ changed: true, removed: 1, folded: 0 })
    expect(titles(json)).toEqual(['一个问题', '保留'])
    expect(json.paging).toMatchObject({ is_end: false })
    expect(seen.map(i => i.id)).toEqual(['feed-0', 'feed-1', 'feed-2'])
    expect(Object.isFrozen(seen[0])).toBe(true)
    expect(Object.isFrozen(seen[0]?.content)).toBe(true)
  })

  test('整页都被过滤时不删，改为记下来在页面上折叠', () => {
    const store = new ContentStore()
    const json = recommend([apiAnswer('1'), apiAnswer('2')])
    const result = processResponse(json, { kind: 'feed' }, store, { feed: () => false })
    expect(result).toEqual({ changed: false, removed: 0, folded: 2 })
    expect(json.data).toHaveLength(2)
    expect(store.isFolded('answer:1')).toBe(true)
    expect(store.isFolded('answer:2')).toBe(true)
  })

  test('整页被过滤时，广告照样去掉', () => {
    const store = new ContentStore()
    const json = moments()
    const result = processResponse(json, { kind: 'feed' }, store, { feed: () => false })
    expect(result).toEqual({ changed: true, removed: 1, folded: 3 })
    expect((json.data as { id: string }[]).map(x => x.id)).toEqual(['m-1', 'm-3'])
    expect(store.isFolded('question:2101')).toBe(true)
  })

  test('关注流：广告和分组里的条目', () => {
    const store = new ContentStore()
    const json = moments()
    const result = processResponse(json, { kind: 'feed' }, store, {
      feed: item => item.kind !== 'ad' && item.content?.title !== '另一个问题',
    })
    expect(result).toEqual({ changed: true, removed: 1, folded: 0 })
    const data = json.data as { id: string; list?: { id: string }[] }[]
    expect(data.map(x => x.id)).toEqual(['m-1', 'm-3'])
    expect(data[1]?.list?.map(x => x.id)).toEqual(['m-3-1'])
    expect(store.feedItem('answer:1101')?.reason).toBe('用户7、用户8 赞同了回答')
  })

  test('分组里全部被过滤时去掉整个分组', () => {
    const json = moments()
    processResponse(json, { kind: 'feed' }, new ContentStore(), { feed: item => item.content?.type !== 'question' })
    expect((json.data as { id: string }[]).map(x => x.id)).toEqual(['m-1', 'm-2'])
  })

  test('问题页的回答列表', () => {
    const store = new ContentStore()
    const json = questionFeeds([apiAnswer('1'), apiAnswer('2', { author: { id: 'b', name: '屏蔽的人' } })])
    const result = processResponse(json, { kind: 'answers' }, store, {
      answers: a => a.author?.name !== '屏蔽的人',
      feed: () => false,
    })
    expect(result).toMatchObject({ changed: true, removed: 1 })
    expect((json.data as { target: { id: string } }[]).map(x => x.target.id)).toEqual(['1'])
    expect(store.content('answer:2')).toBeDefined()
  })

  test('搜索结果：非内容条目不参与整页规则', () => {
    const store = new ContentStore()
    const json = search()
    const result = processResponse(json, { kind: 'search' }, store, { search: r => r.kind !== 'content' })
    // 3 条内容全被过滤，只剩一条"相关搜索"：按整页被过滤处理，内容保留下来折叠
    expect(result).toEqual({ changed: false, removed: 0, folded: 3 })
    expect(json.data).toHaveLength(4)

    const json2 = search()
    const result2 = processResponse(json2, { kind: 'search' }, store, { search: r => r.content?.type !== 'article' })
    expect(result2).toEqual({ changed: true, removed: 1, folded: 0 })
    expect(store.searchResult('video:5201')).toMatchObject({ kind: 'content' })
  })

  test('评论：一级评论、子评论和楼中楼接口', () => {
    const store = new ContentStore()
    const json = rootComments([
      apiComment('c1', {
        child_comments: [apiComment('c1-1', { content: '广告' }), apiComment('c1-2')],
        child_comment_count: 2,
      }),
      apiComment('c2', { content: '<p>广告</p>' }),
    ])
    const endpoint = { kind: 'comments', target: { type: 'article', id: '9' } } as const
    const result = processResponse(json, endpoint, store, { comments: c => !c.text.includes('广告') })
    expect(result).toEqual({ changed: true, removed: 1, folded: 0 })
    const data = json.data as { id: string; child_comments: { id: string }[] }[]
    expect(data.map(c => c.id)).toEqual(['c1'])
    expect(data[0]?.child_comments.map(c => c.id)).toEqual(['c1-2'])
    expect(store.comment('c1-2')).toMatchObject({ parentId: 'c1', target: { type: 'article', id: '9' } })

    const child = { data: [apiComment('c3', { reply_root_comment_id: 'c1' })], root: apiComment('c1') }
    processResponse(child, { kind: 'comments', rootId: 'c1' }, store, {})
    expect(store.comment('c3')).toMatchObject({ parentId: 'c1', target: { type: 'article', id: '9' } })
  })

  test('整页评论都被过滤时保留并记下', () => {
    const store = new ContentStore()
    const json = rootComments([apiComment('c1'), apiComment('c2')])
    processResponse(json, { kind: 'comments' }, store, { comments: () => false })
    expect(json.data).toHaveLength(2)
    expect(store.isFolded('comment:c2')).toBe(true)
  })

  test('其他接口：单个内容或列表', () => {
    const store = new ContentStore()
    processResponse(apiAnswer('77'), { kind: 'contents' }, store, {})
    processResponse({ data: [{ target: apiArticle('78') }, apiArticle('79')] }, { kind: 'contents' }, store, {})
    expect(['answer:77', 'article:78', 'article:79'].map(k => store.hasContent(k))).toEqual([true, true, true])
  })

  test('数据结构不对时不出错', () => {
    const store = new ContentStore()
    for (const json of [null, 'x', [], { data: 'x' }, { data: [null, 1, 'x'] }]) {
      expect(processResponse(json, { kind: 'feed' }, store, { feed: () => false }).changed).toBe(false)
    }
    // 无法识别的条目也交给过滤函数
    const json = { data: [null, {}] }
    expect(processResponse(json, { kind: 'feed' }, store, { feed: item => item.kind !== 'other' })).toMatchObject({
      changed: true,
      removed: 1,
    })
    expect(json.data).toEqual([null])
  })
})

describe('ContentStore', () => {
  test('同一内容再次出现时合并字段', () => {
    const store = new ContentStore()
    store.putContent({
      type: 'answer',
      id: '1',
      url: 'u',
      title: '旧',
      question: { id: '9', title: '旧' },
      html: '<p>x</p>',
    })
    store.putContent({ type: 'answer', id: '1', url: 'u', title: '新', question: { id: '9', title: '新' } })
    expect(store.content('answer:1')).toMatchObject({ title: '新', html: '<p>x</p>' })
  })

  test('超出容量时丢掉最早的', () => {
    const store = new ContentStore(2)
    for (const id of ['1', '2', '3']) store.putContent({ type: 'pin', id, url: '', title: '' })
    expect(['1', '2', '3'].map(id => store.hasContent(`pin:${id}`))).toEqual([false, true, true])
  })

  test('读取首屏数据', () => {
    const store = new ContentStore()
    expect(store.absorbInitialData(initialData())).toBe(2)
    expect(store.content('answer:1301')).toMatchObject({
      url: 'https://www.zhihu.com/question/2301/answer/1301',
      voteupCount: 20000,
      author: { urlToken: 'user-3' },
      wordCount: 6,
    })
    expect(store.content('question:2301')).toMatchObject({ answerCount: 5 })
    expect(store.absorbInitialData({})).toBe(0)
    expect(store.absorbInitialData(null)).toBe(0)
  })
})
