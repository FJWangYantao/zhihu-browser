import { defineContentScript } from 'wxt/utils/define-content-script'

// ISOLATED world 内容脚本：插件宿主、知乎适配层和官方插件从这里启动（M1 逐步实现）。
export default defineContentScript({
  matches: ['*://*.zhihu.com/*'],
  runAt: 'document_start',
  main() {},
})
