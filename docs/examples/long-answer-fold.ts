// 渲染钩子：在每个回答上做事。超过指定字数的回答默认折叠，并在标题旁显示字数。
// ctx.ui 里的标签、折叠、按钮都由宿主放到正确的位置，内容被移除或插件停用时自动清理。
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'long-answer-fold',
  name: '长文折叠',
  version: '1.0.0',
  api: 1,
  description: '超过指定字数的回答默认折叠，并在标题旁显示字数',
  settings: {
    minWords: { type: 'number', label: '折叠阈值（字）', default: 3000, min: 500, step: 500 },
  },
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  z.on('content', (content, ctx) => {
    // 带 ? 的字段在部分页面上可能拿不到，必须处理缺失的情况
    if (content.type !== 'answer' || content.wordCount === undefined) return
    ctx.ui.badge(`${content.wordCount} 字`, { tone: 'muted' })
    if (content.wordCount >= z.settings.get('minWords')) {
      ctx.ui.fold(`长文，约 ${content.wordCount} 字`)
    }
  })
}
