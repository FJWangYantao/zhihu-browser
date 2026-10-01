// 网络：z.fetch 只能访问 meta.permissions 里声明的域名，不能访问知乎自己的域名，不带知乎的 Cookie。
// 安装时用户会看到这个域名，并在浏览器里授权。命令出现在命令面板里（Ctrl+K / ⌘K）。
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'github-zen',
  name: 'GitHub 禅语',
  version: '1.0.0',
  api: 1,
  description: '在命令面板里加一条命令：从 GitHub 取一句话，用提示显示出来',
  permissions: ['net:api.github.com'],
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  z.registerCommand('zen', {
    title: 'GitHub 禅语',
    keywords: ['github', 'zen'],
    run: async () => {
      try {
        const response = await z.fetch('https://api.github.com/zen', { timeout: 10_000 })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        z.ui.toast(await response.text())
      } catch (e) {
        // 网络出错时给用户一个说得清的提示，而不是静默失败
        z.log.error('取禅语失败', e)
        z.ui.toast('取禅语失败，稍后再试', { tone: 'error' })
      }
    },
  })
}
