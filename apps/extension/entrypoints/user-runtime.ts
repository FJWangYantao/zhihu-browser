import { boot } from '@zhihu-browser/remote'
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script'

// 用户插件的 SDK 运行时。不会注入知乎页面：后台读出这份脚本的内容，和每个插件的代码拼在一起，
// 注册给 chrome.userScripts，运行在用户脚本环境里（见 src/user-plugins/scripts.ts）。
export default defineUnlistedScript(() => {
  ;(globalThis as { __zbBoot?: unknown }).__zbBoot = boot
})
