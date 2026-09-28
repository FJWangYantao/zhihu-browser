import type { PageInfo, PageType } from '@zhihu-browser/sdk'

const RULES: [RegExp, PageType, string[]][] = [
  [/^\/question\/(\d+)\/answer\/(\d+)/, 'answer', ['questionId', 'answerId']],
  [/^\/question\/(\d+)/, 'question', ['questionId']],
  [/^\/search\/?$/, 'search', []],
  [/^\/follow\/?$/, 'follow', []],
  [/^\/hot\/?$/, 'hot', []],
  [/^\/(?:people|org)\/([^/]+)/, 'people', ['urlToken']],
  [/^\/collection\/(\d+)/, 'collection', ['collectionId']],
  [/^\/pin\/(\d+)/, 'pin', ['pinId']],
  [/^\/topic\/(\d+)/, 'topic', ['topicId']],
  [/^\/zvideo\/(\d+)/, 'video', ['videoId']],
]

/** 根据网址识别页面类型和路由参数。 */
export function pageInfo(href: string): PageInfo {
  const u = new URL(href)
  const params: Record<string, string> = {}
  if (u.hostname === 'zhuanlan.zhihu.com') {
    const m = /^\/p\/(\d+)/.exec(u.pathname)
    if (m?.[1]) return { type: 'article', url: u.href, params: { articleId: m[1] } }
    return { type: 'other', url: u.href, params }
  }
  if (u.pathname === '/') return { type: 'home', url: u.href, params }
  for (const [re, type, names] of RULES) {
    const m = re.exec(u.pathname)
    if (!m) continue
    names.forEach((name, i) => {
      const value = m[i + 1]
      if (value) params[name] = decodeURIComponent(value)
    })
    if (type === 'search') params.q = u.searchParams.get('q') ?? ''
    return { type, url: u.href, params }
  }
  return { type: 'other', url: u.href, params }
}

/**
 * 这块内容是不是当前页面的主体（回答页上的那个回答、文章页上的文章、问题页顶部的问题等）。
 * 用户专门打开的内容不参与过滤。
 */
export function isSubject(content: { type: string; id: string }, page: PageInfo): boolean {
  const p = page.params
  switch (page.type) {
    case 'answer':
      return (
        (content.type === 'answer' && content.id === p.answerId) ||
        (content.type === 'question' && content.id === p.questionId)
      )
    case 'question':
      return content.type === 'question' && content.id === p.questionId
    case 'article':
      return content.type === 'article' && content.id === p.articleId
    case 'pin':
      return content.type === 'pin' && content.id === p.pinId
    case 'video':
      return content.type === 'video' && content.id === p.videoId
    default:
      return false
  }
}
