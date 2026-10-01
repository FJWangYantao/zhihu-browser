// 屏蔽作者：设置里放一个作者名单，过滤函数去掉名单里的人；每块内容上加一个"不再看 TA"按钮，
// 点击后用确认框问一下，再把作者写进设置（z.settings.set）。
import type { Author, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'mute-authors',
  name: '屏蔽作者',
  version: '1.0.0',
  api: 1,
  description: '在内容上加一个"不再看 TA"按钮，名单里的作者的内容在渲染之前就去掉',
  settings: {
    authors: {
      type: 'list',
      label: '屏蔽的作者（用户主页地址里的标识）',
      default: [],
      description: '每行一个，如 /people/xxx 里的 xxx',
    },
  },
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  const muted = (author?: Author) => !!author?.urlToken && z.settings.get('authors').includes(author.urlToken)

  z.filter('feed', item => !muted(item.content?.author))
  z.filter('answers', answer => !muted(answer.author))
  z.filter('comments', comment => !muted(comment.author))

  z.on('content', (content, ctx) => {
    const author = content.author
    if (!author?.urlToken || author.isAnonymous) return
    ctx.ui.addAction({
      label: '不再看 TA',
      title: `屏蔽 ${author.name}`,
      onClick: async () => {
        if (!(await z.ui.confirm(`以后不再看 ${author.name} 的内容？`))) return
        const token = author.urlToken as string
        await z.settings.set('authors', [...z.settings.get('authors'), token])
        z.ui.toast(`已屏蔽 ${author.name}`)
      },
    })
    if (muted(author)) ctx.ui.fold(`已屏蔽 ${author.name}`)
  })
}
