// 全局界面 + 命令 + 快捷键：一个简化的阅读模式。
// z.contents.current() 是屏幕上方的那块内容，正文 HTML 在 data.html 里（页面拿到全文时才有）。
// z.ui.mount('overlay', …) 挂一个覆盖整个页面的层，返回的函数用来关闭。
import type { Answer, Article, PageType, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'simple-reader',
  name: '阅读模式（简化版）',
  version: '0.1.0',
  api: 1,
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  let close: (() => void) | undefined

  function toggle() {
    if (close) {
      close()
      close = undefined
      return
    }
    const target = z.contents.current()?.data
    if (!target || (target.type !== 'answer' && target.type !== 'article') || !target.html) {
      z.ui.toast('当前位置没有可以阅读的全文')
      return
    }
    close = z.ui.mount('overlay', container => render(container, target))
  }

  const when: PageType[] = ['question', 'answer', 'article']
  z.registerCommand('toggle', { title: '打开 / 关闭阅读模式', when, run: toggle })
  z.registerShortcut('r', toggle, { description: '打开 / 关闭阅读模式', when })

  // 切换页面时关闭
  z.on('page', () => {
    close?.()
    close = undefined
  })
}

function render(container: HTMLElement, content: Answer | Article) {
  const style = document.createElement('style')
  style.textContent = `
    .reader {
      min-height: 100vh; box-sizing: border-box;
      max-width: 42em; margin: 0 auto; padding: 48px 24px;
      font: 18px/1.9 serif; background: #fff; color: #1a1a1a;
    }`
  const article = document.createElement('article')
  article.className = 'reader'
  const title = document.createElement('h1')
  title.textContent = content.title
  const body = document.createElement('div')
  // 知乎提供的正文 HTML；正式的阅读模式插件还要先清理一遍（见官方插件 plugins/reader）
  body.innerHTML = content.html ?? ''
  article.append(title, body)
  container.append(style, article)
}
