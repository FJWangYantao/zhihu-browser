// 运行时（用户脚本环境）与代理（扩展隔离环境）之间的消息。一律是 JSON。
// 约定：运行时分配的 id 是数字，代理分配的 id（口令）是字符串。

import type {
  Answer,
  Comment,
  Content,
  FeedItem,
  GlobalSlot,
  PageInfo,
  PluginMeta,
  SearchResult,
  ShortcutOptions,
} from '@zhihu-browser/sdk'

/** 运行时 → 代理：调用 */
export interface RuntimeCalls {
  /** 运行时已就绪（同时也是对 probe 的回应） */
  hello: undefined
  /** 登记过滤函数 */
  filter: { id: number; kind: 'feed' | 'answers' | 'comments' | 'search' }
  /** 登记页面 / 内容 / 评论钩子 */
  on: { id: number; event: 'page' | 'content' | 'comment' }
  command: { id: number; cmdId: string; title: string; keywords?: string[]; when?: PageInfo['type'][] }
  shortcut: { id: number; keys: string; options: ShortcutOptions }
  addStyle: { id: number; css: string }
  /** 全局挂载点；代理会在容器准备好时调用运行时的 mount.render */
  mount: { id: number; slot: GlobalSlot }
  /** 内容 / 评论上的界面工具，tid 是钩子上下文的口令 */
  'item.badge': {
    id: number
    tid: string
    text: string
    options?: { tone?: 'info' | 'warn' | 'muted'; title?: string }
  }
  'item.fold': { id: number; tid: string; reason: string }
  'item.action': { id: number; tid: string; label: string; title?: string }
  'item.mount': { id: number; tid: string; position: 'before' | 'after' }
  /** 撤销一次登记 */
  dispose: { id: number }
  'handle.call': { hid: string; method: 'expand' | 'collapse' | 'scrollIntoView' }
  'handle.visible': { hid: string }
  'contents.all': undefined
  'contents.current': undefined
  'ui.toast': { message: string; options?: { tone?: 'info' | 'success' | 'warn' | 'error'; duration?: number } }
  'ui.confirm': { message: string; options?: { okText?: string; cancelText?: string } }
  'settings.set': { key: string; value: unknown }
  'storage.get': { key: string }
  'storage.set': { key: string; value: unknown }
  'storage.delete': { key: string }
  'storage.keys': undefined
  fetch: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number } }
  log: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }
}

/** 代理 → 运行时：调用 */
export interface HostCalls {
  /** 问一声运行时是否在线；在线就回 hello */
  probe: undefined
  /** 开始运行插件；插件的默认函数返回（或它返回的 Promise 完成）后才回复 */
  start: { meta: PluginMeta; settings: Record<string, unknown>; page: PageInfo }
  /** 停止：调用插件的清理函数，撤销运行时一侧的全部登记 */
  stop: undefined
  /** 过滤函数 */
  'call.filter': { id: number; item: FeedItem | Answer | Comment | SearchResult }
  /** 页面 / 内容 / 评论钩子。content、comment 的元素通过口令 tid 取回 */
  'call.page': { id: number; tid: string; page: PageInfo }
  'call.content': { id: number; tid: string; hid: string; page: PageInfo; data: Content }
  'call.comment': { id: number; tid: string; page: PageInfo; data: Comment }
  /** 钩子上下文失效（元素被移除、离开页面） */
  abort: { tid: string }
  'call.command': { id: number }
  'call.shortcut': { id: number }
  /** 按钮被点击 */
  'call.action': { id: number }
  /** 挂载点的容器准备好了，由运行时渲染；容器通过口令 token 取回 */
  'mount.render': { id: number; token: string }
  /** 容器要被撤销，运行时调用渲染函数返回的清理函数 */
  'mount.dispose': { id: number }
  /** 页面切换 */
  'page.set': { page: PageInfo }
  /** 设置变了：values 是全部设置，changed 是变化了的键 */
  'settings.update': { values: Record<string, unknown>; changed: string[] }
}

export interface ContentsEntry {
  hid: string
  data: Content
}

export interface FetchResult {
  status: number
  ok: boolean
  headers: Record<string, string>
  text: string
}
