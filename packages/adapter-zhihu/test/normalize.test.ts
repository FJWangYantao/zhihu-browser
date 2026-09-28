import { describe, expect, test } from 'vitest'
import { htmlToText, wordCount } from '../src/html'
import { toAuthor, toComment, toContent, toFeedItem, toSearchResult } from '../src/normalize'
import { keyOf, parseContentUrl } from '../src/refs'
import { pageInfo } from '../src/routes'
import {
  apiAnswer,
  apiArticle,
  apiComment,
  apiPin,
  apiQuestion,
  apiVideo,
  author,
  hotList,
  moments,
  search,
  T0,
} from './fixtures'

describe('htmlToText', () => {
  test('去掉标签、解码实体、合并空白', () => {
    expect(htmlToText('<p>第一段</p><p>第二段&nbsp;&amp;&lt;x&gt; &#26263;&#x6697;</p>')).toBe(
      '第一段 第二段 &<x> 暗暗',
    )
    expect(htmlToText('含有<em>关键词</em>的摘要')).toBe('含有关键词的摘要')
    expect(htmlToText('a<br>b')).toBe('a b')
    expect(htmlToText('&unknown; ok')).toBe('&unknown; ok')
  })

  test('字数不计空白', () => {
    expect(wordCount('第一段 第二段 abc')).toBe(9)
  })
})

describe('toContent', () => {
  test('回答：网址指向网页，时间换成毫秒，正文和字数', () => {
    expect(toContent(apiAnswer())).toEqual({
      type: 'answer',
      id: '1001',
      url: 'https://www.zhihu.com/question/2001/answer/1001',
      title: '一个问题',
      excerpt: '第一段 第二段 & 更多',
      author: {
        id: 'a1b2c3d4',
        urlToken: 'user-1',
        name: '用户1',
        headline: '一句话介绍',
        avatarUrl: 'https://pic.example.com/avatar-1.jpg',
        isOrg: false,
      },
      createdAt: T0 * 1000,
      updatedAt: (T0 + 600) * 1000,
      voteupCount: 12,
      commentCount: 3,
      isPaid: false,
      question: { id: '2001', title: '一个问题' },
      html: '<p>第一段</p><p>第二段 &amp; 更多</p>',
      wordCount: 9,
    })
  })

  test('文章、问题、想法、视频', () => {
    expect(toContent(apiArticle())).toMatchObject({
      type: 'article',
      id: '4001',
      url: 'https://zhuanlan.zhihu.com/p/4001',
      title: '一篇文章',
      createdAt: T0 * 1000,
      updatedAt: (T0 + 60) * 1000,
      wordCount: 4,
    })
    expect(toContent(apiQuestion())).toMatchObject({
      type: 'question',
      id: '2001',
      url: 'https://www.zhihu.com/question/2001',
      answerCount: 42,
      followerCount: 1000,
      detailHtml: '<p>问题描述</p>',
    })
    expect(toContent(apiPin())).toMatchObject({ type: 'pin', id: '6001', title: '', text: '想法 正文' })
    expect(toContent(apiVideo())).toMatchObject({
      type: 'video',
      id: '5001',
      url: 'https://www.zhihu.com/zvideo/5001',
      excerpt: '视频简介',
      duration: 61,
      createdAt: T0 * 1000,
    })
  })

  test('首屏数据的 camelCase 字段', () => {
    const answer = toContent({
      id: 9,
      type: 'answer',
      question: { id: 8, title: 'Q' },
      author: { id: 'x', urlToken: 't', name: 'n', isOrg: true },
      createdTime: T0,
      voteupCount: 1,
      commentCount: 2,
      paidInfo: { type: 'paid' },
    })
    expect(answer).toMatchObject({
      id: '9',
      url: 'https://www.zhihu.com/question/8/answer/9',
      author: { id: 'x', urlToken: 't', name: 'n', isOrg: true },
      voteupCount: 1,
      commentCount: 2,
      isPaid: true,
    })
  })

  test('付费标记', () => {
    expect(toContent(apiAnswer('1', { paid_info: { type: 'paid_column_content' } }))?.isPaid).toBe(true)
    expect(toContent(apiAnswer('1', { is_zhi_plus_content: true }))?.isPaid).toBe(true)
    expect(toContent(apiAnswer('1', { paid_info: { type: 'free' } }))?.isPaid).toBe(false)
  })

  test('不是内容，或缺少 id', () => {
    expect(toContent({ type: 'people', id: '1' })).toBeUndefined()
    expect(toContent({ type: 'answer' })).toBeUndefined()
    expect(toContent('answer')).toBeUndefined()
    expect(toContent(null)).toBeUndefined()
  })
})

test('toAuthor：匿名用户、机构、字符串引用', () => {
  expect(toAuthor(author(1, { id: '0', url_token: '', name: '匿名用户' }))).toMatchObject({
    id: '0',
    name: '匿名用户',
    isAnonymous: true,
  })
  expect(toAuthor(author(1, { url_token: '' }))?.urlToken).toBeUndefined()
  expect(toAuthor({ id: 'o', name: '机构', user_type: 'organization' })?.isOrg).toBe(true)
  expect(toAuthor('user-3', { 'user-3': { id: 'u3', name: '用户3', urlToken: 'user-3' } })).toEqual({
    id: 'u3',
    name: '用户3',
    urlToken: 'user-3',
  })
  expect(toAuthor({})).toBeUndefined()
})

describe('toFeedItem', () => {
  test('关注流：推荐理由、广告', () => {
    const [voted, ad, group] = moments().data as unknown[]
    expect(toFeedItem(voted)).toMatchObject({
      id: 'm-1',
      kind: 'content',
      reason: '用户7、用户8 赞同了回答',
      content: { type: 'answer', id: '1101' },
    })
    expect(toFeedItem(ad)).toEqual({ id: 'm-2', kind: 'ad' })
    expect(toFeedItem(group)).toEqual({ id: 'm-3', kind: 'other' })
  })

  test('热榜卡片变成问题', () => {
    const [first, second] = hotList().data as unknown[]
    expect(toFeedItem(first)).toEqual({
      id: '0_1700000000.1',
      kind: 'content',
      content: {
        type: 'question',
        id: '3001',
        url: 'https://www.zhihu.com/question/3001',
        title: '热点问题',
        excerpt: '热点问题的摘要',
      },
    })
    expect(toFeedItem(second)?.content).not.toHaveProperty('excerpt')
    // 首屏数据里的 camelCase 卡片
    expect(
      toFeedItem({ type: 'hot_list_feed', target: { titleArea: { text: 'T' }, link: { url: '/question/7' } } })
        ?.content,
    ).toMatchObject({ type: 'question', id: '7', title: 'T' })
  })

  test('无法识别的条目', () => {
    expect(toFeedItem({ id: 'x', type: 'market_card' })).toEqual({ id: 'x', kind: 'promotion' })
    expect(toFeedItem({ id: 'y', type: 'feed', target: { type: 'unknown' } })).toEqual({ id: 'y', kind: 'other' })
    expect(toFeedItem(1)).toBeUndefined()
  })
})

test('toSearchResult：问题标题在 question.name 里，去掉高亮标签', () => {
  const [answer, article, video, other] = search().data as unknown[]
  expect(toSearchResult(answer)).toMatchObject({
    id: 'answer:1201',
    kind: 'content',
    content: {
      title: '关键词相关问题',
      excerpt: '含有关键词的摘要',
      question: { id: '2201', title: '关键词相关问题' },
    },
  })
  expect(toSearchResult(article)?.content?.isPaid).toBe(true)
  expect(toSearchResult(video)?.content).toMatchObject({ type: 'video', id: '5201' })
  expect(toSearchResult(other)).toEqual({ id: '', kind: 'other' })
})

test('toComment', () => {
  expect(toComment(apiComment('c1'), { target: { type: 'article', id: '4001' } })).toEqual({
    id: 'c1',
    author: {
      id: 'a6b2c3d4',
      urlToken: 'user-6',
      name: '用户6',
      headline: '一句话介绍',
      avatarUrl: 'https://pic.example.com/avatar-6.jpg',
      isOrg: false,
      isAnonymous: false,
    },
    text: '一条评论',
    html: '<p>一条评论</p>',
    createdAt: T0 * 1000,
    likeCount: 5,
    target: { type: 'article', id: '4001' },
  })
  const child = toComment(apiComment('c2', { reply_root_comment_id: 'c1', reply_to_author: author(7) }))
  expect(child).toMatchObject({ parentId: 'c1', replyTo: { name: '用户7' } })
  expect(toComment(apiComment('c3'), { rootId: 'c1' })?.parentId).toBe('c1')
  expect(toComment({ content: 'x' })).toBeUndefined()
})

test('parseContentUrl', () => {
  expect(parseContentUrl('https://www.zhihu.com/question/1/answer/2')).toEqual({
    type: 'answer',
    id: '2',
    questionId: '1',
  })
  expect(parseContentUrl('//zhuanlan.zhihu.com/p/3')).toEqual({ type: 'article', id: '3' })
  expect(parseContentUrl('https://api.zhihu.com/answers/4')).toEqual({ type: 'answer', id: '4' })
  expect(parseContentUrl('/pin/5')).toEqual({ type: 'pin', id: '5' })
  expect(parseContentUrl('https://www.zhihu.com/zvideo/6')).toEqual({ type: 'video', id: '6' })
  expect(parseContentUrl('https://www.zhihu.com/question/7')).toEqual({ type: 'question', id: '7' })
  expect(parseContentUrl('https://www.zhihu.com/people/someone')).toBeUndefined()
  expect(parseContentUrl('https://example.com/question/7')).toBeUndefined()
  expect(keyOf({ type: 'answer', id: '2' })).toBe('answer:2')
})

describe('pageInfo', () => {
  test.each([
    ['https://www.zhihu.com/', 'home', {}],
    ['https://www.zhihu.com/follow', 'follow', {}],
    ['https://www.zhihu.com/hot', 'hot', {}],
    ['https://www.zhihu.com/question/1', 'question', { questionId: '1' }],
    ['https://www.zhihu.com/question/1/answer/2', 'answer', { questionId: '1', answerId: '2' }],
    ['https://zhuanlan.zhihu.com/p/3', 'article', { articleId: '3' }],
    ['https://www.zhihu.com/search?type=content&q=%E7%9F%A5%E4%B9%8E', 'search', { q: '知乎' }],
    ['https://www.zhihu.com/people/some-one/answers', 'people', { urlToken: 'some-one' }],
    ['https://www.zhihu.com/org/an-org', 'people', { urlToken: 'an-org' }],
    ['https://www.zhihu.com/collection/4', 'collection', { collectionId: '4' }],
    ['https://www.zhihu.com/pin/5', 'pin', { pinId: '5' }],
    ['https://www.zhihu.com/topic/6/hot', 'topic', { topicId: '6' }],
    ['https://www.zhihu.com/zvideo/7', 'video', { videoId: '7' }],
    ['https://www.zhihu.com/settings/account', 'other', {}],
    ['https://zhuanlan.zhihu.com/write', 'other', {}],
  ])('%s', (url, type, params) => {
    expect(pageInfo(url)).toEqual({ type, url, params })
  })
})
