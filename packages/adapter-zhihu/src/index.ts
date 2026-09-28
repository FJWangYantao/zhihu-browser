// zhihu-browser 知乎适配层：把知乎多变的页面和数据翻译成插件 API 里稳定的数据和事件。知乎改版只修这一层。
// 页面主环境（MAIN world）部分从 '@zhihu-browser/adapter-zhihu/main-world' 导入；
// 样式从 './styles.css'（界面工具、预隐藏）和 './theme.css'（主题 token 的映射）导入。

export { DATA_API } from './api-urls'
export type { ToIsolated, ToMain } from './bridge'
export { DIAGNOSE_ANCHORS, type DiagnoseOptions, describeElement, describePage } from './diagnose'
export { findSidebar } from './dom/anchors'
export { classify, type Endpoint, type Filters, type ProcessResult, processResponse } from './endpoints'
export {
  ANCHOR_SPECS,
  type AnchorExpect,
  type AnchorHealth,
  type AnchorSpec,
  checkAnchors,
  FEATURE_NAMES,
  type FeatureId,
  type HealthReport,
  type HealthStage,
  type HealthSummary,
} from './health'
export { type Adapter, type AdapterOptions, createAdapter } from './isolated'
export { toAuthor, toComment, toContent, toFeedItem, toSearchResult } from './normalize'
export { keyOf, parseContentUrl, type Ref } from './refs'
export { isSubject, pageInfo } from './routes'
export { ContentStore } from './store'
export { createThemeSync, syncingStyles, THEME_TOKENS, type ThemeSync, type ThemeToken } from './theme'
