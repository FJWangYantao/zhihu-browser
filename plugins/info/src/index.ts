// 官方插件"信息增强"：在内容标题旁显示完整的发布时间、编辑时间和字数。
// 知乎在信息流和回答列表里常常只显示"编辑于"，发布时间要把鼠标移上去才看得到。
//
// 只用了插件 API 里 stable 的部分（渲染钩子和 ctx.ui.badge）。

import type { Content, ContentContext, Dispose, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'info',
  name: '信息增强',
  version: '0.1.0',
  api: 1,
  description: '在内容标题旁显示完整的发布时间、编辑时间和字数',
  settings: {
    showCreated: { type: 'boolean', label: '显示发布时间', default: true, description: '问题显示提问时间' },
    showUpdated: { type: 'boolean', label: '显示编辑时间', default: true, description: '只在发布后编辑过时显示' },
    timeFormat: {
      type: 'select',
      label: '时间的写法',
      default: 'datetime',
      options: {
        datetime: '日期和时间（2024-05-01 13:45）',
        date: '只写日期（2024-05-01）',
        relative: '多久以前（3 天前）',
      },
    },
    showWordCount: {
      type: 'boolean',
      label: '显示字数',
      default: true,
      description: '回答和文章，页面拿到了全文时才能统计',
    },
  },
} satisfies PluginMeta

export interface InfoOptions {
  showCreated: boolean
  showUpdated: boolean
  timeFormat: string
  showWordCount: boolean
}

export interface Badge {
  text: string
  title: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** 发布后这么久以内的修改不算编辑 */
const EDIT_THRESHOLD = MINUTE
/** 估算阅读时间：每分钟读多少字 */
const WORDS_PER_MINUTE = 400

const pad = (n: number) => String(n).padStart(2, '0')

/** 本地时间：2024-05-01、2024-05-01 13:45 或 2024-05-01 13:45:09 */
export function formatDate(ms: number, parts: 'date' | 'minute' | 'second' = 'minute'): string {
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (parts === 'date') return date
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return parts === 'minute' ? `${date} ${time}` : `${date} ${time}:${pad(d.getSeconds())}`
}

/** 多久以前：刚刚、5 分钟前、3 小时前、2 天前、4 个月前、3 年前 */
export function formatRelative(ms: number, now: number): string {
  const diff = now - ms
  // 电脑时钟不准、内容时间比现在还晚时也算"刚刚"
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))} 个月前`
  return `${Math.floor(diff / (365 * DAY))} 年前`
}

/** 字数：不到一万写全，一万以上写成"1.2 万字" */
export function formatWords(n: number): string {
  if (n < 10_000) return `${n} 字`
  return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')} 万字`
}

function timeBadge(label: string, ms: number, options: InfoOptions, now: number): Badge {
  const text =
    options.timeFormat === 'relative'
      ? formatRelative(ms, now)
      : formatDate(ms, options.timeFormat === 'date' ? 'date' : 'minute')
  return { text: `${label} ${text}`, title: `${label} ${formatDate(ms, 'second')}` }
}

/** 一块内容要显示哪些标签 */
export function badgesFor(content: Content, options: InfoOptions, now: number): Badge[] {
  const out: Badge[] = []
  const { createdAt, updatedAt } = content
  if (options.showCreated && createdAt) {
    out.push(timeBadge(content.type === 'question' ? '提问于' : '发布于', createdAt, options, now))
  }
  // 问题的"修改时间"可能是别人改了问题描述，不显示
  const edited = content.type !== 'question' && createdAt && updatedAt && updatedAt - createdAt >= EDIT_THRESHOLD
  if (options.showUpdated && edited && updatedAt) out.push(timeBadge('编辑于', updatedAt, options, now))
  if (options.showWordCount && (content.type === 'answer' || content.type === 'article') && content.wordCount) {
    const minutes = Math.max(1, Math.round(content.wordCount / WORDS_PER_MINUTE))
    out.push({
      text: formatWords(content.wordCount),
      title: `约 ${minutes} 分钟读完（按每分钟 ${WORDS_PER_MINUTE} 字估算）`,
    })
  }
  return out
}

interface Entry {
  content: Content
  ctx: ContentContext
  badges: Dispose[]
}

export default function info(z: PluginAPI<typeof meta>) {
  const live = new Set<Entry>()

  const options = (): InfoOptions => ({
    showCreated: z.settings.get('showCreated'),
    showUpdated: z.settings.get('showUpdated'),
    timeFormat: z.settings.get('timeFormat'),
    showWordCount: z.settings.get('showWordCount'),
  })

  function render(entry: Entry, opts: InfoOptions, now: number): void {
    for (const remove of entry.badges) remove()
    entry.badges = badgesFor(entry.content, opts, now).map(b =>
      entry.ctx.ui.badge(b.text, { tone: 'muted', title: b.title }),
    )
  }

  z.on('content', (content, ctx) => {
    const entry: Entry = { content, ctx, badges: [] }
    live.add(entry)
    ctx.signal.addEventListener('abort', () => live.delete(entry), { once: true })
    render(entry, options(), Date.now())
  })

  z.settings.onChange(() => {
    const opts = options()
    const now = Date.now()
    for (const entry of live) render(entry, opts, now)
  })
}
