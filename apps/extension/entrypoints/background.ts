import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

// 后台：打开设置页（点击扩展图标，或者知乎页面上命令面板里的"打开设置页"）。
// 插件安装与更新、z.fetch 网络代理、权限管理等在后续里程碑加入。
// 后台可能被浏览器回收，不能放在插件启动的关键路径上（见 docs/spike-report.md）。
export default defineBackground(() => {
  browser.action.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage()
  })
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // 只接受本扩展的内容脚本发来的消息
    if (sender.id !== browser.runtime.id) return
    if ((message as { type?: unknown } | null)?.type === 'open-options') void browser.runtime.openOptionsPage()
  })
})
