import { installMainWorld } from '@zhihu-browser/adapter-zhihu/main-world'
import { defineContentScript } from 'wxt/utils/define-content-script'

// 页面主环境（MAIN world）：拦截知乎前端请求到的接口响应、发现页面切换。只放最少的代码，不运行任何插件。
// 必须在 document_start 最早执行（见 docs/spike-report.md 2.3 节）。
export default defineContentScript({
  matches: ['*://*.zhihu.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installMainWorld()
  },
})
