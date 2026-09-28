// 知乎接口响应的处理：识别接口、把数据存进实体仓库、在知乎渲染之前运行过滤函数。

import type { Answer, Comment, Content, FeedItem, SearchResult } from '@zhihu-browser/sdk'
import { DATA_API } from './api-urls'
import { toComment, toContent, toFeedItem, toSearchResult } from './normalize'
import { keyOf } from './refs'
import type { ContentStore } from './store'
import { isObj, type Obj } from './util'

export type Endpoint =
  /** 首页推荐、关注、热榜 */
  | { kind: 'feed' }
  /** 问题页的回答列表 */
  | { kind: 'answers' }
  | { kind: 'search' }
  /** 一级评论（target 是评论所属的内容）或楼中楼（rootId 是根评论） */
  | { kind: 'comments'; target?: Comment['target']; rootId?: string }
  /** 其他带内容的接口：只存进实体仓库，不过滤 */
  | { kind: 'contents' }

const COMMENT_TARGETS: Record<string, Content['type']> = {
  answers: 'answer',
  articles: 'article',
  pins: 'pin',
  zvideos: 'video',
  questions: 'question',
}

/** 识别接口；不是需要处理的接口时返回 undefined */
export function classify(href: string): Endpoint | undefined {
  if (!DATA_API.test(href)) return undefined
  const path = new URL(href).pathname
  if (/^\/api\/v3\/feed\/topstory\/(?:recommend|hot-lists?)\b/.test(path)) return { kind: 'feed' }
  // 关注流是 /api/v3/moments；/api/v3/moments/<用户>/activities 是用户主页的动态，不属于信息流
  if (/^\/api\/v3\/moments\/?$/.test(path)) return { kind: 'feed' }
  if (/^\/api\/v4\/questions\/\d+\/(?:feeds|answers)\b/.test(path)) return { kind: 'answers' }
  if (/^\/api\/v4\/search_v3\b/.test(path)) return { kind: 'search' }
  const root = /^\/api\/v4\/comment_v5\/(answers|articles|pins|zvideos|questions)\/(\d+)\/root_comment\b/.exec(path)
  if (root?.[1] && root[2]) {
    const type = COMMENT_TARGETS[root[1]]
    return type ? { kind: 'comments', target: { type, id: root[2] } } : { kind: 'comments' }
  }
  const child = /^\/api\/v4\/comment_v5\/comment\/(\d+)\/child_comment\b/.exec(path)
  if (child?.[1]) return { kind: 'comments', rootId: child[1] }
  return { kind: 'contents' }
}

/** 各类过滤函数；没有插件注册某类过滤函数时留空，这类数据就不会被改动 */
export interface Filters {
  feed?: (item: FeedItem) => boolean
  answers?: (answer: Answer) => boolean
  search?: (result: SearchResult) => boolean
  comments?: (comment: Comment) => boolean
}

export interface ProcessResult {
  /** 数据被改动了，需要把新的响应交给知乎 */
  changed: boolean
  /** 去掉的条目数 */
  removed: number
  /** 为了不让整页变空而保留、要在页面上折叠的条目数 */
  folded: number
}

interface Entry {
  raw: unknown
  keep: boolean
  /** 是内容：整页都被过滤时保留下来，在页面上折叠 */
  foldable: boolean
  /** 在页面上折叠时用的键 */
  keys: string[]
  /** 条目被保留时，对它内部的删减（关注流的分组、一级评论下的子评论）；有改动时返回 true */
  trim?: () => boolean
}

const UNCHANGED: ProcessResult = { changed: false, removed: 0, folded: 0 }

/**
 * 处理一个接口响应：把内容存进仓库，按过滤函数删掉条目。直接修改传入的 json。
 *
 * 一页里的内容全部被过滤时不删：M0 发现整页被删空后，知乎会不停地请求下一页。
 * 这时保留这些内容条目，记进仓库，由适配层在页面上把它们折叠起来。
 */
export function processResponse(
  json: unknown,
  endpoint: Endpoint,
  store: ContentStore,
  filters: Filters,
): ProcessResult {
  if (!isObj(json)) return UNCHANGED
  switch (endpoint.kind) {
    case 'feed':
      return settle(json, store, raw => feedEntry(raw, store, filters))
    case 'answers':
      return settle(json, store, raw => answerEntry(raw, store, filters))
    case 'search':
      return settle(json, store, raw => searchEntry(raw, store, filters))
    case 'comments':
      return processComments(json, endpoint, store, filters)
    case 'contents':
      absorb(json, store)
      return UNCHANGED
  }
}

function settle(json: Obj, store: ContentStore, toEntry: (raw: unknown) => Entry): ProcessResult {
  const list = json.data
  if (!Array.isArray(list)) {
    absorb(json, store)
    return UNCHANGED
  }
  const entries = list.map(toEntry)
  let result = entries.filter(e => e.keep)
  let folded = 0
  // 内容全被过滤（剩下的最多是"相关搜索"这类小卡片）：保留被过滤的内容，在页面上折叠；广告等照样去掉
  const filteredContent = entries.filter(e => !e.keep && e.foldable)
  if (filteredContent.length && !result.some(e => e.foldable)) {
    result = entries.filter(e => e.keep || e.foldable)
    for (const e of filteredContent) {
      for (const key of e.keys) store.markFolded(key)
      folded += e.keys.length
    }
  }
  let changed = result.length !== entries.length
  for (const e of result) if (e.keep && e.trim?.()) changed = true
  if (changed) json.data = result.map(e => e.raw)
  return { changed, removed: entries.length - result.length, folded }
}

const keep = <T>(fn: ((item: T) => boolean) | undefined, item: T) => (fn ? fn(item) : true)

function feedEntry(raw: unknown, store: ContentStore, filters: Filters): Entry {
  // 关注流的分组（"某人赞同了 3 个回答"）：里面的条目逐个过滤，全部被过滤时去掉整个分组
  if (isObj(raw) && Array.isArray(raw.list)) {
    const group = raw
    const inner = (raw.list as unknown[]).map(x => feedEntry(x, store, filters))
    return {
      raw,
      keep: inner.some(e => e.keep),
      foldable: inner.some(e => e.foldable),
      keys: inner.flatMap(e => e.keys),
      trim() {
        if (inner.every(e => e.keep)) return false
        group.list = inner.filter(e => e.keep).map(e => e.raw)
        return true
      },
    }
  }
  const item = toFeedItem(raw)
  if (!item) return { raw, keep: true, foldable: false, keys: [] }
  const stored = store.putFeedItem(item)
  const key = stored.content ? keyOf(stored.content) : undefined
  return { raw, keep: keep(filters.feed, stored), foldable: stored.kind === 'content' && !!key, keys: key ? [key] : [] }
}

function answerEntry(raw: unknown, store: ContentStore, filters: Filters): Entry {
  const content = isObj(raw) ? (toContent(raw.target) ?? toContent(raw)) : undefined
  if (!content) return { raw, keep: true, foldable: false, keys: [] }
  const stored = store.putContent(content)
  if (stored.type !== 'answer') return { raw, keep: true, foldable: false, keys: [] }
  return { raw, keep: keep(filters.answers, stored), foldable: true, keys: [keyOf(stored)] }
}

function searchEntry(raw: unknown, store: ContentStore, filters: Filters): Entry {
  const result = toSearchResult(raw)
  if (!result) return { raw, keep: true, foldable: false, keys: [] }
  const stored = store.putSearchResult(result)
  const key = stored.content ? keyOf(stored.content) : undefined
  return {
    raw,
    keep: keep(filters.search, stored),
    foldable: stored.kind === 'content' && !!key,
    keys: key ? [key] : [],
  }
}

function processComments(
  json: Obj,
  endpoint: Extract<Endpoint, { kind: 'comments' }>,
  store: ContentStore,
  filters: Filters,
): ProcessResult {
  // 楼中楼接口会附带根评论；子评论所属的内容沿用根评论的
  let target = endpoint.target
  if (endpoint.rootId) {
    target = store.comment(endpoint.rootId)?.target ?? target
    const root = toComment(json.root, { target })
    if (root) store.putComment(root)
  }
  const commentEntry = (raw: unknown, rootId?: string): Entry => {
    const comment = toComment(raw, { target, rootId })
    if (!comment) return { raw, keep: true, foldable: false, keys: [] }
    store.putComment(comment)
    const children = isObj(raw) && Array.isArray(raw.child_comments) ? raw.child_comments : []
    const inner = children.map(x => commentEntry(x, comment.id))
    return {
      raw,
      keep: keep(filters.comments, comment),
      foldable: true,
      keys: [`comment:${comment.id}`],
      trim() {
        if (inner.every(e => e.keep) || !isObj(raw)) return false
        raw.child_comments = inner.filter(e => e.keep).map(e => e.raw)
        return true
      },
    }
  }
  return settle(json, store, raw => commentEntry(raw, endpoint.rootId))
}

/** 其他接口：尽量把里面的内容存进仓库 */
function absorb(json: Obj, store: ContentStore): void {
  const single = toContent(json)
  if (single) store.putContent(single)
  const list = json.data
  if (!Array.isArray(list)) return
  for (const x of list) {
    const content = toContent(x) ?? (isObj(x) ? (toContent(x.target) ?? toContent(x.object)) : undefined)
    if (content) store.putContent(content)
  }
}
