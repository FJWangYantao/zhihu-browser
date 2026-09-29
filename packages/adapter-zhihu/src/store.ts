import type { Comment, Content, FeedItem, SearchResult } from '@zhihu-browser/sdk'
import { toContent, toFeedItem } from './normalize'
import { keyOf } from './refs'
import { deepFreeze, isObj } from './util'

const BUCKETS = ['answers', 'articles', 'questions', 'pins', 'zvideos'] as const

/**
 * 实体仓库：页面已经拿到的内容（首屏数据和接口响应），按 'answer:123' 这样的键保存。
 * 识别页面元素时从这里取数据。容量有限，超出时丢掉最早的。
 * 存进来的对象会被冻结，插件拿到的是同一份只读数据。
 */
export class ContentStore {
  private readonly contents = new Map<string, Content>()
  private readonly feedItems = new Map<string, FeedItem>()
  private readonly searchResults = new Map<string, SearchResult>()
  private readonly comments = new Map<string, Comment>()
  private readonly folded = new Map<string, true>()

  constructor(private readonly limit = 3000) {}

  private put<V>(map: Map<string, V>, key: string, value: V): V {
    map.delete(key)
    map.set(key, value)
    if (map.size > this.limit) {
      const oldest = map.keys().next().value
      if (oldest !== undefined) map.delete(oldest)
    }
    return value
  }

  /** 保存内容；同一内容再次出现时合并字段（新数据里有的字段覆盖旧的） */
  putContent(content: Content): Content {
    const key = keyOf(content)
    const old = this.contents.get(key)
    const merged = old ? ({ ...old, ...content } as Content) : content
    return this.put(this.contents, key, deepFreeze(merged))
  }

  content(key: string): Content | undefined {
    return this.contents.get(key)
  }

  hasContent(key: string): boolean {
    return this.contents.has(key)
  }

  /** 保存信息流条目，同时保存其中的内容。返回的条目引用仓库里合并后的内容。 */
  putFeedItem(item: FeedItem): FeedItem {
    if (!item.content) return deepFreeze(item)
    const content = this.putContent(item.content)
    return this.put(this.feedItems, keyOf(content), deepFreeze({ ...item, content }))
  }

  /** 页面元素对应的信息流条目（按内容的键查找） */
  feedItem(key: string): FeedItem | undefined {
    return this.feedItems.get(key)
  }

  putSearchResult(result: SearchResult): SearchResult {
    if (!result.content) return deepFreeze(result)
    const content = this.putContent(result.content)
    return this.put(this.searchResults, keyOf(content), deepFreeze({ ...result, content }))
  }

  searchResult(key: string): SearchResult | undefined {
    return this.searchResults.get(key)
  }

  putComment(comment: Comment): Comment {
    return this.put(this.comments, comment.id, deepFreeze(comment))
  }

  comment(id: string): Comment | undefined {
    return this.comments.get(id)
  }

  hasComments(): boolean {
    return this.comments.size > 0
  }

  /** 仓库里所有内容和评论的键：内容是 'answer:123'，评论是 'comment:456'（页面样本用） */
  keys(): string[] {
    return [...this.contents.keys(), ...[...this.comments.keys()].map(id => `comment:${id}`)]
  }

  /**
   * 记下"为了不让整页变空而保留"的条目（键是内容的键或 'comment:评论 id'）。
   * 它们会被知乎渲染出来，由适配层在页面上折叠。
   */
  markFolded(key: string): void {
    this.put(this.folded, key, true)
  }

  isFolded(key: string): boolean {
    return this.folded.has(key)
  }

  /** 读取首屏数据（js-initialData）里的实体，返回保存了多少条 */
  absorbInitialData(data: unknown): number {
    const state = isObj(data) ? data.initialState : undefined
    if (!isObj(state)) return 0
    let count = 0
    const entities = isObj(state.entities) ? state.entities : {}
    const users = isObj(entities.users) ? entities.users : undefined
    for (const bucket of BUCKETS) {
      const table = entities[bucket]
      if (!isObj(table)) continue
      for (const raw of Object.values(table)) {
        const content = toContent(raw, users)
        if (content) {
          this.putContent(content)
          count++
        }
      }
    }
    // 直接打开热榜时，热榜可能在首屏数据里
    const topstory = isObj(state.topstory) ? state.topstory : {}
    const hotList = topstory.hotList ?? topstory.hotListData
    if (Array.isArray(hotList)) {
      for (const raw of hotList) {
        const item = toFeedItem(raw, users)
        if (item?.content) {
          this.putFeedItem(item)
          count++
        }
      }
    }
    return count
  }
}
