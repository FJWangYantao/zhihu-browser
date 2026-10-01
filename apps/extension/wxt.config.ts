import { defineConfig } from 'wxt'

export default defineConfig({
  manifest: {
    name: 'zhihu-browser',
    description: '开源的知乎浏览增强扩展：核心小而稳定，功能都由插件提供。',
    minimum_chrome_version: '138',
    // userScripts：用户插件的运行通道（Chrome 138+ 需要用户在扩展详情页打开"允许用户脚本"）
    permissions: ['storage', 'userScripts'],
    // 用户插件通过 z.fetch 访问外部域名时，安装时由用户逐个授权
    optional_host_permissions: ['*://*/*'],
    host_permissions: ['*://*.zhihu.com/*'],
    action: { default_title: 'zhihu-browser 设置' },
  },
  vite: () => ({
    // 设置页用 Preact 的 JSX
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
})
