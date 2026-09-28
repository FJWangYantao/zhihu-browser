import { defineBackground } from 'wxt/utils/define-background'

// 后台：插件安装与更新、设置存储、z.fetch 网络代理、权限管理（M1 逐步实现）。
// 后台可能被浏览器回收，不能放在插件启动的关键路径上（见 docs/spike-report.md）。
export default defineBackground(() => {})
