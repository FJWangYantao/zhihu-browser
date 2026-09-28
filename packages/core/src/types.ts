import type {
  ContentHandle,
  Dispose,
  FetchInit,
  FetchResponse,
  GlobalUI,
  ItemUI,
  PageType,
  PluginMeta,
} from '@zhihu-browser/sdk'

/** 插件的运行状态。 */
export type PluginState = 'inactive' | 'active' | 'failed'

/** 宿主调用插件代码的场合，用于计时和报错统计。 */
export type HookKind =
  | 'entry'
  | 'page'
  | 'filter'
  | 'content'
  | 'comment'
  | 'command'
  | 'shortcut'
  | 'settings'
  | 'ui'
  | 'cleanup'

export type FilterKind = 'feed' | 'answers' | 'comments' | 'search'

export interface HookStats {
  calls: number
  totalMs: number
  maxMs: number
  /** 超出耗时预算的次数 */
  overBudget: number
}

export interface PluginStats {
  /** 累计报错次数 */
  errors: number
  hooks: Partial<Record<HookKind, HookStats>>
  /** 持续超出耗时预算的场合 */
  slow: HookKind[]
}

export interface PluginInfo {
  id: string
  meta: PluginMeta
  state: PluginState
  /** 用户是否启用了这个插件 */
  enabled: boolean
  /** 最近一次状态变化的原因，如"已停用"、"1 分钟内报错超过 10 次" */
  reason?: string
  stats: PluginStats
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  pluginId: string
  level: LogLevel
  time: number
  message: string
}

export interface CommandInfo {
  /** 带插件前缀的完整 id，如 'simple-reader.toggle' */
  id: string
  pluginId: string
  title: string
  keywords: string[]
  when?: PageType[]
}

/** 运行平台：决定快捷键里的 mod 是 ⌘（macOS）还是 Ctrl */
export type Platform = 'mac' | 'other'

/** 用户改键：快捷键的 id（'插件 id:原来的写法'）→ 新的写法；空字符串表示停用 */
export type Keymap = Record<string, string>

export interface ShortcutInfo {
  /** 改键时用的标识：'插件 id:原来的写法'，如 'reader:r' */
  id: string
  /** 生效的写法（规范化后），如 'shift+j'、'g g'；停用时是空字符串 */
  keys: string
  /** 插件注册时的写法 */
  defaultKeys: string
  /** 插件 id；宿主自己的快捷键是 '@host' */
  pluginId: string
  description: string
  when?: PageType[]
  /** 与之冲突、并且优先的一方（宿主或先注册的插件）；有值表示这个快捷键不会生效 */
  conflictWith?: string
  /** 用户停用了这个快捷键 */
  disabled?: true
}

/** 适配层为一个内容元素或评论元素提供的东西。 */
export interface ItemTarget {
  /** 元素本身（核心不会读写它，只转交给插件） */
  el: HTMLElement
  /** 适配层为这个元素实现的界面工具 */
  ui: ItemUI
  /** 元素被移除时中止 */
  signal: AbortSignal
}

export interface ContentTarget extends ItemTarget {
  handle: ContentHandle
}

/** 设置的持久化（扩展里用 chrome.storage 实现）。 */
export interface SettingsBackend {
  load(pluginId: string): Promise<Record<string, unknown>>
  save(pluginId: string, values: Record<string, unknown>): Promise<void>
  /** 设置在别处被修改时（设置页、其他标签页、导入数据包）回调 */
  subscribe(pluginId: string, onChange: (values: Record<string, unknown>) => void): Dispose
}

/** 插件存储的持久化。namespace 是插件 id。 */
export interface StorageBackend {
  get(namespace: string, key: string): Promise<unknown>
  set(namespace: string, key: string, value: unknown): Promise<void>
  delete(namespace: string, key: string): Promise<void>
  keys(namespace: string): Promise<string[]>
}

/** 宿主所在环境提供的能力。核心本身不接触 DOM、网络和扩展 API。 */
export interface HostServices {
  settings: SettingsBackend
  storage: StorageBackend
  /** 发出网络请求。调用前核心已经做过权限检查。 */
  fetch(pluginId: string, url: string, init: FetchInit & { timeout: number }): Promise<FetchResponse>
  /** 全局界面：提示、确认框、全局挂载点 */
  ui: GlobalUI
  /** 向页面注入全局样式，返回移除函数 */
  addStyle(css: string): Dispose
  /** 当前页面上已识别的内容（由适配层提供） */
  contents: {
    all(): ContentHandle[]
    current(): ContentHandle | undefined
  }
  /** 输出日志；不提供时输出到 console */
  log?(entry: LogEntry): void
  /** 当前时间（毫秒），测试时可以替换 */
  now?(): number
}

export interface HostOptions {
  services: HostServices
  /** 安全模式：插件只登记，不运行 */
  safeMode?: boolean
  /** 熔断：统计报错的时间窗口，默认 60000 毫秒 */
  errorWindowMs?: number
  /** 熔断：时间窗口内允许的报错次数，超过就停用插件，默认 10 */
  maxErrors?: number
  /** 运行平台，决定快捷键里的 mod，默认 'other' */
  platform?: Platform
  /** 用户改过的快捷键 */
  keymap?: Keymap
  /** 按键序列（如 'g g'）两次按键之间最多间隔多久（毫秒），默认 1000 */
  sequenceTimeoutMs?: number
}

export interface HostEvents {
  /** 插件状态变化 */
  pluginState: PluginInfo
  /** 过滤函数有增减，或插件设置变了：适配层应当对页面上已有的内容重新过滤 */
  filtersChanged: undefined
  commandsChanged: undefined
  shortcutsChanged: undefined
  log: LogEntry
}
