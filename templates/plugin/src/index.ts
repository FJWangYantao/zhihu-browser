import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

// meta 必须是纯字面量：不能引用变量、调用函数。安装器会在不执行代码的情况下读取它。
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
    if (content.type !== 'answer' || content.wordCount === undefined) return
    ctx.ui.badge(`${content.wordCount} 字`, { tone: 'muted' })
    if (content.wordCount >= z.settings.get('minWords')) {
      ctx.ui.fold(`长文，约 ${content.wordCount} 字`)
    }
  })
}
