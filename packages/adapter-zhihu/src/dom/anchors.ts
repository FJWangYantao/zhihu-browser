// 锚点注册表：和知乎页面结构有关的知识（选择器、属性）都集中在这里。知乎改版时主要修改这个文件。
// 取 id 的顺序按 M0 的结果：data-zop → microdata → React 属性（由页面主环境读取）→ 链接（最不可靠）。
// 禁止使用 css-xxxxxx 这类自动生成的类名。

import type { Content, PageInfo } from '@zhihu-browser/sdk'
import { htmlToText } from '../html'
import { minimalContent } from '../normalize'
import { contentType, parseContentUrl, type Ref } from '../refs'
import { compact, str } from '../util'

/**
 * 内容元素：信息流、问题页、回答页、搜索、用户主页用 .ContentItem；热榜用 .HotItem；
 * 问题页顶部的问题是 .QuestionHeader；专栏文章页没有 .ContentItem，文章本身带 data-zop。
 */
export const CONTENT_SELECTOR = '.ContentItem, .HotItem, .QuestionHeader, [data-zop]'
/** 评论元素：带 data-id 的元素，只有 id 能在实体仓库的评论里找到时才算 */
export const COMMENT_SELECTOR = '[data-id]'
/** 被过滤时要隐藏的外层卡片 */
const CONTAINER_SELECTOR = '.TopstoryItem, .List-item, .HotItem'
/** 标签（badge）放在标题旁 */
const TITLE_SELECTOR = '.ContentItem-title, .HotItem-title, .QuestionHeader-title, .Post-Title'
/** 正文，自定义界面挂在它的前后 */
const BODY_SELECTOR = '.RichContent, .HotItem-content, .QuestionHeader-main, .Post-RichTextContainer'
/** 操作栏（赞同、评论等按钮所在的一行） */
const ACTIONS_SELECTOR = '.ContentItem-actions'
/** 全局挂载点 sidebar：页面的右侧栏 */
export const SIDEBAR_SELECTOR = '.Question-sideColumn, .GlobalSideBar'

/** 页面的右侧栏；没有、或者被主题隐藏了（--zb-sidebar: none）时返回 null */
export function findSidebar(doc: Document = document): Element | null {
  if (doc.documentElement.getAttribute('data-zb-sidebar') === 'none') return null
  return doc.querySelector(SIDEBAR_SELECTOR)
}

/**
 * 是需要识别的内容元素：嵌套在另一个内容元素里的不算。
 * 用户主页的动态流里还有圆桌活动卡片（class 只有 ContentItem，没有 data-zop，
 * 标题链接是 a.RoundTableLink）：它是活动记录不是内容，没有内容 id，跳过。
 */
export function isContentElement(el: Element): boolean {
  if (!el.matches(CONTENT_SELECTOR)) return false
  if (el.parentElement?.closest('.ContentItem, .HotItem, .QuestionHeader')) return false
  return !(
    el.matches('.ContentItem:not([data-zop])') && el.querySelector(':scope > .ContentItem-title a.RoundTableLink')
  )
}

/** 被过滤时隐藏的元素：信息流卡片、列表项；找不到时就是元素本身 */
export function containerOf(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>(CONTAINER_SELECTOR) ?? el
}

interface Zop {
  ref?: Ref
  title?: string
  authorName?: string
}

/** data-zop 属性：{ authorName, itemId, title, type }，回答和文章上都有 */
export function readZop(el: Element): Zop | undefined {
  const raw = el.getAttribute('data-zop')
  if (!raw) return undefined
  try {
    const zop = JSON.parse(raw) as Record<string, unknown>
    const type = contentType(zop.type)
    const id = str(zop.itemId)
    return compact({
      ref: type && id ? { type, id } : undefined,
      title: str(zop.title),
      authorName: str(zop.authorName),
    })
  } catch {
    return undefined
  }
}

interface Microdata {
  ref?: Ref
  questionId?: string
  questionTitle?: string
  authorName?: string
  authorUrlToken?: string
  createdAt?: number
  updatedAt?: number
  voteupCount?: number
  commentCount?: number
}

const metaContent = (scope: Element, name: string) =>
  scope.querySelector(`meta[itemprop="${name}"]`)?.getAttribute('content') ?? undefined

function date(value: string | undefined): number | undefined {
  const t = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(t) ? undefined : t
}

function int(value: string | undefined): number | undefined {
  const n = value ? Number.parseInt(value, 10) : Number.NaN
  return Number.isNaN(n) ? undefined : n
}

/** microdata（itemprop）：内容的网址、日期、数量、作者 */
export function readMicrodata(el: Element): Microdata {
  const out: Microdata = {}
  for (const meta of el.querySelectorAll('meta[itemprop="url"]')) {
    const ref = parseContentUrl(meta.getAttribute('content') ?? '')
    // 元素里还有作者主页、所属问题的网址，只取内容本身的
    if (ref && ref.type !== 'question') {
      out.ref = ref
      break
    }
  }
  const question = el.querySelector('[itemprop="zhihu:question"]')
  if (question) {
    const ref = parseContentUrl(metaContent(question, 'url') ?? '')
    if (ref?.type === 'question') out.questionId = ref.id
    out.questionTitle = metaContent(question, 'name')
  }
  const author = el.querySelector('[itemprop="author"]')
  if (author) {
    out.authorName = metaContent(author, 'name')
    out.authorUrlToken = /\/(?:people|org)\/([^/?#]+)/.exec(metaContent(author, 'url') ?? '')?.[1]
  }
  out.createdAt = date(metaContent(el, 'dateCreated') ?? metaContent(el, 'datePublished'))
  out.updatedAt = date(metaContent(el, 'dateModified'))
  out.voteupCount = int(metaContent(el, 'upvoteCount'))
  out.commentCount = int(metaContent(el, 'commentCount'))
  return compact(out)
}

/** 元素里的内容链接：优先取回答、文章等，找不到再取问题 */
export function linkRef(el: Element): Ref | undefined {
  let question: Ref | undefined
  for (const a of el.querySelectorAll('a[href]')) {
    const ref = parseContentUrl(a.getAttribute('href') ?? '')
    if (!ref) continue
    if (ref.type !== 'question') return ref
    question ??= ref
  }
  return question
}

export interface IdentifyDeps {
  /** 仓库里有没有这块内容 */
  has(key: string): boolean
  /** 请页面主环境读取元素的 React 属性 */
  askReact?(el: Element): { type: string; id: string }[]
}

/** 找出元素对应的内容 */
export function identify(el: HTMLElement, page: PageInfo, deps: IdentifyDeps): Ref | undefined {
  if (el.matches('.QuestionHeader')) {
    const id = page.params.questionId
    return id ? { type: 'question', id } : undefined
  }
  const zop = readZop(el)?.ref
  if (zop) return zop
  const microdata = readMicrodata(el).ref
  if (microdata) return microdata
  // React 属性里可能有多块内容（例如外层列表），只认仓库里有的
  for (const r of deps.askReact?.(el) ?? []) {
    const type = contentType(r.type)
    if (type && deps.has(`${type}:${r.id}`)) return { type, id: r.id }
  }
  return linkRef(el)
}

const textOf = (el: Element | null) => (el ? htmlToText(el.textContent ?? '') : '')

/** 仓库里没有数据时，从页面元素上尽量拼出内容 */
export function contentFromDom(el: HTMLElement, ref: Ref): Content {
  const zop = readZop(el)
  const md = readMicrodata(el)
  const title = zop?.title || md.questionTitle || textOf(el.querySelector(TITLE_SELECTOR))
  const excerpt = textOf(el.querySelector('.RichContent-inner, .HotItem-excerpt, .RichText')).slice(0, 120)
  const authorName = zop?.authorName || md.authorName
  const questionId = ref.questionId ?? md.ref?.questionId ?? md.questionId ?? linkRef(el)?.questionId
  const content = minimalContent({ ...ref, questionId }, title, excerpt)
  return compact({
    ...content,
    author: authorName ? compact({ id: '', name: authorName, urlToken: md.authorUrlToken }) : undefined,
    createdAt: md.createdAt,
    updatedAt: md.updatedAt,
    voteupCount: md.voteupCount,
    commentCount: md.commentCount,
  }) as Content
}

/** 操作栏：只取属于这个元素自己的（不在嵌套的内容元素里） */
export function actionBarOf(el: HTMLElement): HTMLElement | undefined {
  for (const bar of el.querySelectorAll<HTMLElement>(ACTIONS_SELECTOR)) {
    const owner = bar.parentElement?.closest('.ContentItem, .HotItem, .QuestionHeader')
    if (!owner || owner === el || !el.contains(owner)) return bar
  }
  return undefined
}

/** 标签的位置：标题里；评论是作者名后面；都找不到时放在元素开头 */
export function badgeAnchorOf(el: HTMLElement, kind: 'content' | 'comment'): { parent: Element; before: Node | null } {
  if (kind === 'comment') {
    for (const a of el.querySelectorAll('a[href*="/people/"], a[href*="/org/"]')) {
      if (a.textContent?.trim() && a.parentElement) return { parent: a.parentElement, before: a.nextSibling }
    }
    return { parent: el, before: el.firstChild }
  }
  const title = el.querySelector(TITLE_SELECTOR)
  if (title) return { parent: title, before: null }
  return { parent: el, before: el.firstChild }
}

/** 正文元素（自定义界面挂在它的前后） */
export function bodyOf(el: HTMLElement): HTMLElement | undefined {
  return el.querySelector<HTMLElement>(BODY_SELECTOR) ?? undefined
}

/** 展开全文："阅读全文"按钮 */
export const EXPAND_SELECTOR = '.ContentItem-more'
/** 收起："收起"按钮。只点文字是"收起"的那个，避免误点同一位置的其他按钮 */
export const COLLAPSE_SELECTOR = '.ContentItem-rightButton'
export const COLLAPSE_TEXT = '收起'
