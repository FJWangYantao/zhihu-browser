import { defineConfig } from 'wxt'

export default defineConfig({
  manifest: {
    name: 'zhihu-browser',
    description: '开源的知乎浏览增强扩展：核心小而稳定，功能都由插件提供。',
    minimum_chrome_version: '138',
    permissions: ['storage'],
    host_permissions: ['*://*.zhihu.com/*'],
    action: { default_title: 'zhihu-browser 设置' },
  },
  vite: () => ({
    // 设置页用 Preact 的 JSX
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
})
