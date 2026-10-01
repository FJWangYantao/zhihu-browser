import { defineConfig } from 'wxt'

// Chrome / Edge：userScripts 是普通权限，用户需要在扩展详情页打开"允许用户脚本"（Chrome 138+）。
// Firefox（136+，Manifest V3）：userScripts 只能作为可选权限，用到时在设置页里请求。
export default defineConfig({
  manifest: ({ browser }) => {
    const firefox = browser === 'firefox'
    return {
      name: 'zhihu-browser',
      description: '开源的知乎浏览增强扩展：核心小而稳定，功能都由插件提供。',
      ...(firefox
        ? {
            // Firefox 要求 MV3 扩展有固定的 id；上架前换成正式的
            browser_specific_settings: {
              gecko: {
                id: 'zhihu-browser@fjwangyantao.github.io',
                strict_min_version: '136.0',
                // 不收集任何数据
                data_collection_permissions: { required: ['none'] },
              },
            },
            permissions: ['storage'],
            optional_permissions: ['userScripts'],
          }
        : { minimum_chrome_version: '138', permissions: ['storage', 'userScripts'] }),
      // 用户插件通过 z.fetch 访问外部域名时，安装时由用户逐个授权
      optional_host_permissions: ['*://*/*'],
      host_permissions: ['*://*.zhihu.com/*'],
      action: { default_title: 'zhihu-browser 设置' },
    }
  },
  vite: () => ({
    // 设置页用 Preact 的 JSX
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
})
