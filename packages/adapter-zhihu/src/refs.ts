import type { Content } from '@zhihu-browser/sdk'

export type ContentType = Content['type']

/** 一块内容的引用：类型 + id */
export interface Ref {
  type: ContentType
  id: string
  /** 回答所属的问题（从网址里能看出来时才有） */
  questionId?: string
}

/** 实体仓库和页面元素上使用的键，如 'answer:123' */
export const keyOf = (ref: { type: ContentType; id: string }) => `${ref.type}:${ref.id}`

/** 知乎数据里的类型名 → 插件 API 的类型名 */
export function contentType(name: unknown): ContentType | undefined {
  switch (name) {
    case 'answer':
    case 'article':
    case 'question':
    case 'pin':
      return name
    case 'zvideo':
    case 'video':
      return 'video'
    default:
      return undefined
  }
}

/** 内容的网页地址 */
export function webUrl(ref: Ref): string {
  switch (ref.type) {
    case 'answer':
      return ref.questionId
        ? `https://www.zhihu.com/question/${ref.questionId}/answer/${ref.id}`
        : `https://www.zhihu.com/answer/${ref.id}`
    case 'article':
      return `https://zhuanlan.zhihu.com/p/${ref.id}`
    case 'question':
      return `https://www.zhihu.com/question/${ref.id}`
    case 'pin':
      return `https://www.zhihu.com/pin/${ref.id}`
    case 'video':
      return `https://www.zhihu.com/zvideo/${ref.id}`
  }
}

const URL_RULES: [RegExp, ContentType][] = [
  [/^\/(?:questions?)\/(\d+)\/answers?\/(\d+)/, 'answer'],
  [/^\/answers?\/(\d+)/, 'answer'],
  [/^\/p\/(\d+)/, 'article'],
  [/^\/articles?\/(\d+)/, 'article'],
  [/^\/pins?\/(\d+)/, 'pin'],
  [/^\/zvideos?\/(\d+)/, 'video'],
  [/^\/questions?\/(\d+)/, 'question'],
]

/** 从知乎的网址（网页或 api.zhihu.com）里识别内容，识别不了返回 undefined */
export function parseContentUrl(href: string): Ref | undefined {
  let u: URL
  try {
    u = new URL(href, 'https://www.zhihu.com/')
  } catch {
    return undefined
  }
  if (!/(?:^|\.)zhihu\.com$/.test(u.hostname)) return undefined
  for (const [re, type] of URL_RULES) {
    const m = re.exec(u.pathname)
    if (!m) continue
    if (m[2]) return { type, id: m[2], questionId: m[1] }
    if (m[1]) return { type, id: m[1] }
  }
  return undefined
}
