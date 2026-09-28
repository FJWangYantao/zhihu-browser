// 把知乎的数据整理成插件 API 的数据模型（docs/plugin-api.md 第 13 节）。
// 接口数据是 snake_case，首屏数据（js-initialData）是 camelCase，两种都要处理。
// 字段来源见 docs/spike-report.md 第 2.2 节和第 3.4 节。

import type {
  Answer,
  Article,
  Author,
  Comment,
  Content,
  FeedItem,
  Pin,
  Question,
  SearchResult,
  Video,
} from '@zhihu-browser/sdk'
import { htmlToText, wordCount } from './html'
import { contentType, parseContentUrl, type Ref, webUrl } from './refs'
import { compact, isObj, num, type Obj, pick, str, time } from './util'

/** 首屏数据里的用户表，作者字段是字符串引用时用它查找 */
export type UserTable = Obj

export function toAuthor(raw: unknown, users?: UserTable): Author | undefined {
  let o = raw
  if (typeof o === 'string' && users) o = users[o]
  // 旧版评论接口的作者包在 member 里
  if (isObj(o) && isObj(o.member)) o = o.member
  if (!isObj(o)) return undefined
  const id = str(o.id)
  const name = str(o.name)
  if (id === undefined && name === undefined) return undefined
  const urlToken = str(pick(o, 'url_token', 'urlToken'))
  const userType = str(pick(o, 'user_type', 'userType'))
  const isOrg = pick(o, 'is_org', 'isOrg')
  const isAnonymous = pick(o, 'is_anonymous', 'isAnonymous')
  return compact({
    id: id ?? '',
    urlToken: urlToken || undefined,
    name: name ?? '',
    headline: str(o.headline) || undefined,
    avatarUrl: str(pick(o, 'avatar_url', 'avatarUrl')) || undefined,
    isOrg: typeof isOrg === 'boolean' ? isOrg : userType === 'organization' ? true : undefined,
    // 匿名用户的 id 是 '0'
    isAnonymous: isAnonymous === true || id === '0' ? true : typeof isAnonymous === 'boolean' ? false : undefined,
  })
}

/** 付费内容（盐选等）的标记。没有标记时视为免费。 */
function isPaid(o: Obj): boolean {
  const info = pick(o, 'paid_info', 'paidInfo')
  if (isObj(info)) {
    const type = str(info.type) ?? ''
    if (type && !/free/i.test(type)) return true
  }
  if (pick(o, 'is_zhi_plus_content', 'isZhiPlusContent') === true) return true
  const answerType = str(pick(o, 'answer_type', 'answerType'))
  return answerType === 'paid'
}

function excerptOf(o: Obj, text?: string): string | undefined {
  const raw = str(pick(o, 'excerpt', 'excerpt_new', 'excerptNew', 'description'))
  const excerpt = raw ? htmlToText(raw) : ''
  if (excerpt) return excerpt
  return text ? text.slice(0, 120) : undefined
}

/** 正文 HTML、纯文本和字数 */
function body(o: Obj, field = 'content') {
  const html = str(o[field])
  if (!html) return { html: undefined, text: undefined, words: undefined }
  const text = htmlToText(html)
  return { html, text, words: wordCount(text) }
}

function base(o: Obj, ref: Ref, title: string, users: UserTable | undefined, text?: string) {
  return {
    id: ref.id,
    url: webUrl(ref),
    title,
    excerpt: excerptOf(o, text),
    author: toAuthor(o.author, users),
    createdAt: time(pick(o, 'created_time', 'createdTime', 'created', 'published_at', 'created_at')),
    updatedAt: time(pick(o, 'updated_time', 'updatedTime', 'updated', 'updated_at')),
    voteupCount: num(pick(o, 'voteup_count', 'voteupCount', 'vote_count', 'voteCount')),
    commentCount: num(pick(o, 'comment_count', 'commentCount')),
    isPaid: isPaid(o),
  }
}

export function toAnswer(o: Obj, users?: UserTable): Answer | undefined {
  const id = str(o.id)
  if (!id) return undefined
  const q = isObj(o.question) ? o.question : {}
  const questionId = str(q.id) ?? ''
  const title = htmlToText(str(pick(q, 'title', 'name')) ?? '')
  const { html, text, words } = body(o)
  return compact<Answer>({
    type: 'answer',
    ...base(o, { type: 'answer', id, questionId: questionId || undefined }, title, users, text),
    question: { id: questionId, title },
    html,
    wordCount: words,
  })
}

export function toArticle(o: Obj, users?: UserTable): Article | undefined {
  const id = str(o.id)
  if (!id) return undefined
  const column = isObj(o.column) ? o.column : undefined
  const { html, text, words } = body(o)
  return compact<Article>({
    type: 'article',
    ...base(o, { type: 'article', id }, htmlToText(str(o.title) ?? ''), users, text),
    column: column && str(column.id) ? { id: str(column.id) ?? '', title: str(column.title) ?? '' } : undefined,
    html,
    wordCount: words,
  })
}

export function toQuestion(o: Obj, users?: UserTable): Question | undefined {
  const id = str(o.id)
  if (!id) return undefined
  const detail = str(o.detail) || undefined
  return compact<Question>({
    type: 'question',
    ...base(o, { type: 'question', id }, htmlToText(str(pick(o, 'title', 'name')) ?? ''), users),
    answerCount: num(pick(o, 'answer_count', 'answerCount')),
    followerCount: num(pick(o, 'follower_count', 'followerCount', 'follow_count')),
    detailHtml: detail,
  })
}

export function toPin(o: Obj, users?: UserTable): Pin | undefined {
  const id = str(o.id)
  if (!id) return undefined
  // 想法的正文是若干段：{ type: 'text', content } 或图片、链接等
  const parts = Array.isArray(o.content) ? o.content : []
  const text =
    parts
      .filter(isObj)
      .filter(p => p.type === 'text')
      .map(p => htmlToText(str(pick(p, 'content', 'own_text', 'ownText')) ?? ''))
      .filter(Boolean)
      .join(' ') ||
    (typeof o.content === 'string' ? htmlToText(o.content) : '') ||
    undefined
  return compact<Pin>({
    type: 'pin',
    ...base(o, { type: 'pin', id }, htmlToText(str(pick(o, 'excerpt_title', 'excerptTitle')) ?? ''), users, text),
    text,
  })
}

export function toVideo(o: Obj, users?: UserTable): Video | undefined {
  const id = str(o.id)
  if (!id) return undefined
  const video = isObj(o.video) ? o.video : {}
  return compact<Video>({
    type: 'video',
    ...base(o, { type: 'video', id }, htmlToText(str(o.title) ?? ''), users),
    duration: num(pick(video, 'duration')) ?? num(o.duration),
  })
}

/** 按 type 字段识别内容；不是内容（或无法识别）时返回 undefined */
export function toContent(raw: unknown, users?: UserTable): Content | undefined {
  if (!isObj(raw)) return undefined
  switch (contentType(raw.type)) {
    case 'answer':
      return toAnswer(raw, users)
    case 'article':
      return toArticle(raw, users)
    case 'question':
      return toQuestion(raw, users)
    case 'pin':
      return toPin(raw, users)
    case 'video':
      return toVideo(raw, users)
    default:
      return undefined
  }
}

/** 只知道网址、标题、摘要时，拼出一个最小的内容（热榜卡片） */
export function minimalContent(ref: Ref, title: string, excerpt?: string): Content {
  const common = compact({ id: ref.id, url: webUrl(ref), title, excerpt: excerpt || undefined })
  switch (ref.type) {
    case 'answer':
      return { ...common, type: 'answer', question: { id: ref.questionId ?? '', title } }
    case 'article':
      return { ...common, type: 'article' }
    case 'question':
      return { ...common, type: 'question' }
    case 'pin':
      return { ...common, type: 'pin' }
    case 'video':
      return { ...common, type: 'video' }
  }
}

const AD_TYPE = /(?:^|_)(?:ad|advert|ads|advertisement)(?:_|$)/i
const PROMOTION_TYPE = /promotion|market|campaign|commercial/i

/** 热榜卡片：title_area、excerpt_area、link（首屏数据里是 camelCase） */
function hotCard(target: Obj): Content | undefined {
  const link = pick(target, 'link')
  const url = isObj(link) ? str(link.url) : undefined
  const ref = url ? parseContentUrl(url) : undefined
  if (!ref) return undefined
  const area = (name: string) => {
    const a = pick(
      target,
      name,
      name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()),
    )
    return isObj(a) ? htmlToText(str(a.text) ?? '') : ''
  }
  return minimalContent(ref, area('title_area'), area('excerpt_area'))
}

/** 关注流的推荐理由：动作发起人 + 动作，如"张三 赞同了回答" */
function reasonOf(o: Obj): string | undefined {
  const action = str(pick(o, 'action_text', 'actionText'))
  if (!action) return undefined
  const actors = Array.isArray(o.actors) ? o.actors.filter(isObj) : []
  const names = actors
    .map(a => str(a.name))
    .filter((n): n is string => !!n)
    .slice(0, 3)
  return names.length ? `${names.join('、')} ${action}` : action
}

/** 信息流条目：首页推荐（feed）、关注（feed、feed_advert）、热榜（hot_list_feed） */
export function toFeedItem(raw: unknown, users?: UserTable): FeedItem | undefined {
  if (!isObj(raw)) return undefined
  const type = str(raw.type) ?? ''
  const target = isObj(raw.target) ? raw.target : undefined
  const content = toContent(target, users) ?? (target ? hotCard(target) : undefined)
  const id = str(pick(raw, 'id', 'card_id', 'cardId')) ?? (content ? `${content.type}:${content.id}` : '')
  const targetType = str(target?.type) ?? ''
  if (AD_TYPE.test(type) || AD_TYPE.test(targetType) || isObj(raw.ad) || Array.isArray(raw.ad_list)) {
    return { id, kind: 'ad' }
  }
  if (content) return compact<FeedItem>({ id, kind: 'content', content, reason: reasonOf(raw) })
  if (PROMOTION_TYPE.test(type) || PROMOTION_TYPE.test(targetType)) return { id, kind: 'promotion' }
  return { id, kind: 'other' }
}

/** 搜索结果：data[].object 是内容，data[].type 为 search_result、zvideo 等 */
export function toSearchResult(raw: unknown): SearchResult | undefined {
  if (!isObj(raw)) return undefined
  const type = str(raw.type) ?? ''
  const content = toContent(raw.object)
  const id = str(raw.id) ?? (content ? `${content.type}:${content.id}` : '')
  if (AD_TYPE.test(type)) return { id, kind: 'ad' }
  if (content) return { id, kind: 'content', content }
  return { id, kind: 'other' }
}

export interface CommentContext {
  /** 评论所属的内容（一级评论接口的网址里有） */
  target?: Comment['target']
  /** 楼中楼接口里的根评论 id */
  rootId?: string
}

/** 评论（comment_v5） */
export function toComment(raw: unknown, ctx: CommentContext = {}): Comment | undefined {
  if (!isObj(raw)) return undefined
  const id = str(raw.id)
  if (!id) return undefined
  const html = str(raw.content) ?? ''
  const root = str(pick(raw, 'reply_root_comment_id', 'replyRootCommentId'))
  const parentId = root && root !== '0' && root !== id ? root : ctx.rootId && ctx.rootId !== id ? ctx.rootId : undefined
  return compact({
    id,
    author: toAuthor(raw.author),
    text: htmlToText(html),
    html: html || undefined,
    createdAt: time(pick(raw, 'created_time', 'createdTime')),
    likeCount: num(pick(raw, 'like_count', 'likeCount', 'vote_count')),
    parentId,
    replyTo: toAuthor(pick(raw, 'reply_to_author', 'replyToAuthor')),
    target: ctx.target,
  })
}
