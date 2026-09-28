// 官方插件"屏蔽"：按关键词、作者和内容类型屏蔽知乎内容。
// 两种方式：折叠并显示原因（渲染钩子 + ctx.ui.fold），或者直接去掉（过滤函数，在知乎渲染之前）。
// 广告总是在渲染前去掉；评论总是直接去掉。
//
// 只用了插件 API 里 stable 的部分，也是给用户写插件时参考的例子。

import type {
  Author,
  Comment,
  Content,
  ContentContext,
  Dispose,
  PageInfo,
  PluginAPI,
  PluginMeta,
} from '@zhihu-browser/sdk'

export const meta = {
  id: 'filter',
  name: '屏蔽',
  version: '0.1.0',
  api: 1,
  description: '按关键词、作者和内容类型屏蔽知乎内容，可以折叠并显示原因，也可以直接去掉',
  settings: {
    mode: {
      type: 'select',
      label: '屏蔽方式',
      default: 'fold',
      options: { fold: '折叠并显示原因', remove: '直接去掉' },
    },
    keywords: {
      type: 'list',
      label: '屏蔽关键词',
      default: [],
      placeholder: '如：营销号',
      description: '标题、摘要或想法正文里出现这些词时屏蔽，不区分大小写。写成 /正则表达式/ 可以按正则匹配。',
    },
    authors: {
      type: 'list',
      label: '屏蔽作者',
      default: [],
      placeholder: '用户名，或"用户名 @个人主页标识"',
      description:
        '只写用户名时按用户名完全匹配。点内容下方的"屏蔽作者"会同时记下个人主页标识（/people/ 后面那段），作者改名后依然有效。',
    },
    hideAds: { type: 'boolean', label: '屏蔽广告和推广', default: true },
    hideVideos: { type: 'boolean', label: '屏蔽视频', default: false },
    hidePins: { type: 'boolean', label: '屏蔽想法', default: false },
    hidePaid: { type: 'boolean', label: '屏蔽付费内容', default: false, description: '盐选等付费内容' },
    filterComments: {
      type: 'boolean',
      label: '评论也按关键词和作者屏蔽',
      default: true,
      description: '被屏蔽的评论直接去掉',
    },
    showBlockButton: { type: 'boolean', label: '在内容下方显示"屏蔽作者"按钮', default: true },
  },
} satisfies PluginMeta

type Z = PluginAPI<typeof meta>

interface Keyword {
  label: string
  test(text: string, lower: string): boolean
}

interface AuthorRule {
  label: string
  name?: string
  urlToken?: string
}

interface Rules {
  mode: string
  keywords: Keyword[]
  authors: AuthorRule[]
  hideAds: boolean
  hideVideos: boolean
  hidePins: boolean
  hidePaid: boolean
  filterComments: boolean
  showBlockButton: boolean
}

/** 关键词：普通词不区分大小写；/…/ 是正则表达式，写法不对的忽略 */
export function compileKeywords(list: readonly string[]): Keyword[] {
  const out: Keyword[] = []
  for (const raw of list) {
    const word = raw.trim()
    if (!word) continue
    const re = /^\/(.+)\/([a-z]*)$/.exec(word)
    if (re?.[1] !== undefined) {
      // 去掉 g、y：带这两个标志的正则 test() 会记住上次的位置
      const flags = `${(re[2] ?? '').replace(/[gy]/g, '').replace('i', '')}i`
      try {
        const regexp = new RegExp(re[1], flags)
        out.push({ label: word, test: text => regexp.test(text) })
      } catch {
        // 写法不对的正则忽略
      }
      continue
    }
    const lower = word.toLowerCase()
    out.push({ label: word, test: (_text, textLower) => textLower.includes(lower) })
  }
  return out
}

/** 作者：'用户名'、'用户名 @个人主页标识' 或 '@个人主页标识' */
export function compileAuthors(list: readonly string[]): AuthorRule[] {
  const out: AuthorRule[] = []
  for (const raw of list) {
    const entry = raw.trim()
    if (!entry) continue
    const m = /^(.*?)\s*@([\w.-]+)$/.exec(entry)
    if (m?.[2]) out.push({ label: m[1] || m[2], urlToken: m[2] })
    else out.push({ label: entry, name: entry })
  }
  return out
}

export function matchAuthor(author: Author | undefined, rules: readonly AuthorRule[]): AuthorRule | undefined {
  if (!author) return undefined
  return rules.find(rule => (rule.urlToken ? rule.urlToken === author.urlToken : rule.name === author.name))
}

function matchKeyword(texts: readonly string[], keywords: readonly Keyword[]): Keyword | undefined {
  if (!keywords.length) return undefined
  for (const text of texts) {
    if (!text) continue
    const lower = text.toLowerCase()
    const hit = keywords.find(k => k.test(text, lower))
    if (hit) return hit
  }
  return undefined
}

/** 这块内容为什么要屏蔽；不屏蔽时返回 undefined */
export function reasonFor(content: Content, rules: Rules): string | undefined {
  if (rules.hideVideos && content.type === 'video') return '视频'
  if (rules.hidePins && content.type === 'pin') return '想法'
  if (rules.hidePaid && content.isPaid) return '付费内容'
  const author = matchAuthor(content.author, rules.authors)
  if (author) return `作者 ${author.label}`
  const keyword = matchKeyword(
    [content.title, content.excerpt ?? '', content.type === 'pin' ? (content.text ?? '') : ''],
    rules.keywords,
  )
  if (keyword) return `关键词 ${keyword.label}`
  return undefined
}

function commentReason(comment: Comment, rules: Rules): string | undefined {
  if (!rules.filterComments) return undefined
  const author = matchAuthor(comment.author, rules.authors)
  if (author) return `作者 ${author.label}`
  const keyword = matchKeyword([comment.text], rules.keywords)
  return keyword ? `关键词 ${keyword.label}` : undefined
}

/** 用户专门打开的内容（回答页上的回答、文章页的文章等）不屏蔽 */
function isSubject(content: Content, page: PageInfo): boolean {
  const p = page.params
  switch (content.type) {
    case 'answer':
      return page.type === 'answer' && content.id === p.answerId
    case 'article':
      return page.type === 'article' && content.id === p.articleId
    case 'question':
      return (page.type === 'question' || page.type === 'answer') && content.id === p.questionId
    case 'pin':
      return page.type === 'pin' && content.id === p.pinId
    case 'video':
      return page.type === 'video' && content.id === p.videoId
  }
}

/** 在哪些地方屏蔽：信息流、问题页的回答列表、搜索结果。用户主页、收藏夹等地方不动。 */
export function inScope(content: Content, page: PageInfo): boolean {
  if (isSubject(content, page)) return false
  switch (page.type) {
    case 'home':
    case 'follow':
    case 'hot':
    case 'topic':
    case 'search':
      return true
    case 'question':
    case 'answer':
      return content.type === 'answer'
    default:
      return false
  }
}

interface Entry {
  content: Content
  ctx: ContentContext
  reason?: string
  unfold?: Dispose
  removeButton?: Dispose
}

export default function filter(z: Z) {
  let compiled: Rules | undefined
  function rules(): Rules {
    if (!compiled) {
      const s = z.settings
      compiled = {
        mode: s.get('mode'),
        keywords: compileKeywords(s.get('keywords')),
        authors: compileAuthors(s.get('authors')),
        hideAds: s.get('hideAds'),
        hideVideos: s.get('hideVideos'),
        hidePins: s.get('hidePins'),
        hidePaid: s.get('hidePaid'),
        filterComments: s.get('filterComments'),
        showBlockButton: s.get('showBlockButton'),
      }
    }
    return compiled
  }

  // ---------- 直接去掉：过滤函数（广告不论哪种方式都在这里去掉） ----------

  z.filter('feed', item => {
    const r = rules()
    if (r.hideAds && (item.kind === 'ad' || item.kind === 'promotion')) return false
    return r.mode !== 'remove' || !item.content || !reasonFor(item.content, r)
  })
  z.filter('answers', answer => {
    const r = rules()
    return r.mode !== 'remove' || !reasonFor(answer, r)
  })
  z.filter('search', result => {
    const r = rules()
    if (r.hideAds && result.kind === 'ad') return false
    return r.mode !== 'remove' || !result.content || !reasonFor(result.content, r)
  })
  z.filter('comments', comment => !commentReason(comment, rules()))

  // ---------- 折叠并显示原因；"屏蔽作者"按钮 ----------

  const live = new Set<Entry>()

  function update(entry: Entry): void {
    const r = rules()
    const { content, ctx } = entry
    const reason = r.mode === 'fold' && inScope(content, ctx.page) ? reasonFor(content, r) : undefined
    if (reason !== entry.reason) {
      entry.unfold?.()
      entry.unfold = reason ? ctx.ui.fold(reason) : undefined
      entry.reason = reason
    }
    const author = content.author
    const wantButton =
      r.showBlockButton && !!author?.name && !author.isAnonymous && !matchAuthor(author, r.authors) && !reason
    if (wantButton && author && !entry.removeButton) {
      entry.removeButton = ctx.ui.addAction({
        label: '屏蔽作者',
        title: `屏蔽 ${author.name} 的所有内容`,
        onClick: () => blockAuthor(author),
      })
    } else if (!wantButton && entry.removeButton) {
      entry.removeButton()
      entry.removeButton = undefined
    }
  }

  async function blockAuthor(author: Author): Promise<void> {
    const ok = await z.ui.confirm(`屏蔽 ${author.name} 的所有内容？\n以后可以在设置页的"屏蔽作者"里移除。`, {
      okText: '屏蔽',
    })
    if (!ok) return
    const entry = author.urlToken ? `${author.name} @${author.urlToken}` : author.name
    const list = z.settings.get('authors')
    if (!list.includes(entry)) await z.settings.set('authors', [...list, entry])
    z.ui.toast(`已屏蔽 ${author.name}`, { tone: 'success' })
  }

  z.on('content', (content, ctx) => {
    const entry: Entry = { content, ctx }
    live.add(entry)
    ctx.signal.addEventListener('abort', () => live.delete(entry), { once: true })
    update(entry)
  })

  z.settings.onChange(() => {
    compiled = undefined
    for (const entry of live) update(entry)
  })
}
