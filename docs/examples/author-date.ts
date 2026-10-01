// 在每个回答的标题旁显示发布日期，编辑过的再显示"编辑于"。时间都是毫秒时间戳。
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'answer-dates',
  name: '回答日期',
  version: '1.0.0',
  api: 1,
  description: '在回答标题旁显示发布日期，编辑过的显示编辑日期',
} satisfies PluginMeta

const day = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function (z: PluginAPI<typeof meta>) {
  z.on('content', (content, ctx) => {
    if (content.type !== 'answer') return
    if (content.createdAt) ctx.ui.badge(day(content.createdAt), { tone: 'muted' })
    if (content.createdAt && content.updatedAt && content.updatedAt - content.createdAt > 60_000) {
      ctx.ui.badge(`编辑于 ${day(content.updatedAt)}`, { tone: 'muted' })
    }
  })
}
