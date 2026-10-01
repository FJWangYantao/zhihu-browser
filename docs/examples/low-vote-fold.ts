// 综合示例：自己记下每块内容上的界面工具（ctx.ui 返回的 Dispose），设置变了、命令触发时撤销并重做。
// 在每个回答的标题旁显示"赞 {赞同数} · 评 {评论数}"，赞同数低于阈值的回答默认折叠；
// 命令"展开所有低赞回答"撤销页面上这类折叠，直到设置再被修改。
// 这份代码是一个只读过 docs/ai-guide.md 的 AI 按需求写出来的（见 packages/remote/test/ai-plugin.test.ts 的验证）。
import type { Dispose, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'low-vote-fold',
  name: '低赞回答折叠',
  version: '1.0.0',
  api: 1,
  description: '在回答标题旁显示赞同数和评论数，赞同数低于设置值的回答默认折叠',
  settings: {
    minVotes: { type: 'number', label: '最低赞同数', default: 10, min: 0, step: 1 },
    foldLow: { type: 'boolean', label: '折叠低赞回答', default: true },
  },
} satisfies PluginMeta

// 页面上每个已显示回答的状态：当前的标签和折叠，以及重新渲染的方法
interface Entry {
  votes: number
  comments: number
  disposeBadge?: Dispose
  disposeFold?: Dispose
  // 用户是否已用命令展开（展开后不再自动折叠，直到设置被修改）
  released: boolean
  render: () => void
}

export default function (z: PluginAPI<typeof meta>) {
  // 当前页面上所有已处理的回答
  const entries = new Set<Entry>()

  z.on('content', (content, ctx) => {
    // 只处理回答；赞同数、评论数可能缺失，缺失按 0 处理
    if (content.type !== 'answer') return

    const entry: Entry = {
      votes: content.voteupCount ?? 0,
      comments: content.commentCount ?? 0,
      released: false,
      render: () => {},
    }

    // 按当前设置重新显示标签和折叠：先撤销旧的，再按新设置添加
    entry.render = () => {
      entry.disposeBadge?.()
      entry.disposeFold?.()
      entry.disposeBadge = undefined
      entry.disposeFold = undefined

      // 标签始终显示
      entry.disposeBadge = ctx.ui.badge(`赞 ${entry.votes} · 评 ${entry.comments}`, { tone: 'muted' })

      // 开关打开、赞同数低于阈值、且用户没有手动展开时才折叠
      const threshold = z.settings.get('minVotes')
      if (z.settings.get('foldLow') && !entry.released && entry.votes < threshold) {
        entry.disposeFold = ctx.ui.fold(`赞同数低于 ${threshold}`)
      }
    }

    entries.add(entry)
    entry.render()

    // 元素被移除、离开页面或插件停用时，不再跟踪这个回答
    ctx.signal.addEventListener('abort', () => {
      entries.delete(entry)
    })
  })

  // 设置在设置页被修改后，立即更新页面上已有的回答（标签和折叠）
  z.settings.onChange(() => {
    for (const entry of entries) {
      entry.released = false // 设置变了，按新设置重新判断
      try {
        entry.render()
      } catch (e) {
        z.log.error('按新设置更新回答失败', e)
      }
    }
  })

  // 命令：撤销当前页面上所有由本插件产生的折叠
  z.registerCommand('expand-low', {
    title: '展开所有低赞回答',
    keywords: ['展开', '低赞', '折叠'],
    run: () => {
      let count = 0
      for (const entry of entries) {
        if (entry.disposeFold) {
          entry.disposeFold()
          entry.disposeFold = undefined
          count++
        }
        entry.released = true
      }
      z.ui.toast(count > 0 ? `已展开 ${count} 个低赞回答` : '当前页面没有被折叠的低赞回答')
    },
  })
}
