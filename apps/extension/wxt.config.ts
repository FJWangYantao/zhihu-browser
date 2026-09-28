import { defineConfig } from 'wxt'

export default defineConfig({
  manifest: {
    name: 'zhihu-browser',
    description: '开源的知乎浏览增强扩展：核心小而稳定，功能都由插件提供。',
    minimum_chrome_version: '138',
    permissions: ['storage'],
    host_permissions: ['*://*.zhihu.com/*'],
  },
})
