// zhihu-browser 插件 API（api: 1，草案 v0）
//
// 这是插件与核心之间的契约，说明文档见 docs/plugin-api.md。
// 每个 API 的稳定性级别用 @stable / @experimental / @unstable 标出（见文档第 14 节）。
// 本文件只包含类型：插件里请使用 `import type`。

// ---------- 插件文件 ----------

/** 撤销一次注册。重复调用无副作用。 */
export type Dispose = () => void

/**
 * 插件信息：插件文件里的 `export const meta`。
 * 必须是纯字面量（安装器会在不执行代码的情况下静态解析），可以加 `satisfies PluginMeta` 获得类型检查。
 * @stable
 */
export interface PluginMeta {
  /** 唯一标识：小写字母、数字和连字符，如 'long-answer-fold' */
  id: string
  /** 显示名称 */
  name: string
  /** 语义化版本号，如 '1.2.0' */
  version: string
  /** 依赖的插件 API 大版本 */
  api: 1
  description?: string
  author?: string
  homepage?: string
  /** 所需权限。省略表示不访问任何外部网络 */
  permissions?: Permission[]
  /** 设置项定义，宿主据此自动生成设置界面 */
  settings?: Record<string, SettingSpec>
}

/** 插件入口：插件文件的默认导出。每个标签页执行一次，可以返回一个清理函数。 */
// biome-ignore lint/suspicious/noConfusingVoidType: 回调可以不返回值，也可以返回清理函数；改成 undefined 会拒绝普通的 () => void 函数
export type PluginEntry<M extends PluginMeta = PluginMeta> = (z: PluginAPI<M>) => void | Dispose

/** 一个插件文件的导出内容（宿主加载插件时使用）。 */
export interface PluginModule<M extends PluginMeta = PluginMeta> {
  meta: M
  default: PluginEntry<M>
}

// ---------- API 总览 ----------

export interface PluginAPI<M extends PluginMeta = PluginMeta> {
  /** @stable */
  readonly meta: M

  /**
   * 当前页面。
   * @stable
   */
  page(): PageInfo

  /**
   * 页面切换：插件激活时对当前页面触发一次，之后每次切换页面再触发。
   * @stable
   */
  on(event: 'page', handler: (page: PageInfo, ctx: PageContext) => void): Dispose
  /**
   * 渲染钩子：页面上每出现一块内容就调用一次（元素被替换时会再调用）。
   * @stable
   */
  on(event: 'content', handler: (content: Content, ctx: ContentContext) => void): Dispose
  /**
   * 渲染钩子：每条评论出现时调用。
   * @stable
   */
  on(event: 'comment', handler: (comment: Comment, ctx: ItemContext) => void): Dispose

  /**
   * 过滤（渲染前）：返回 true 保留，false 去掉。必须是同步的纯函数。
   * @stable
   */
  filter(kind: 'feed', fn: (item: FeedItem) => boolean): Dispose
  filter(kind: 'answers', fn: (answer: Answer) => boolean): Dispose
  filter(kind: 'comments', fn: (comment: Comment) => boolean): Dispose
  filter(kind: 'search', fn: (result: SearchResult) => boolean): Dispose

  /**
   * 当前页面上已识别的内容。
   * @experimental
   */
  contents: {
    /** 全部内容，按在页面上的顺序排列 */
    all(): ContentHandle[]
    /** 视口中最靠上的一块内容 */
    current(): ContentHandle | undefined
  }

  /**
   * 在命令面板里注册命令。命令 id 在插件内唯一，宿主会自动加上插件 id 作为前缀。
   * @stable
   */
  registerCommand(id: string, command: Command): Dispose
  /**
   * 注册快捷键，如 'j'、'shift+j'、'mod+enter'、'g g'。焦点在输入区域时不触发。
   * @stable
   */
  registerShortcut(keys: string, run: () => void, options: ShortcutOptions): Dispose

  /** @stable */
  settings: Settings<SettingsOf<M>>

  /** @experimental */
  ui: GlobalUI
  /**
   * 向知乎页面注入全局样式，插件停用时自动移除。直接针对知乎选择器的样式属于 unstable。
   * @stable
   */
  addStyle(css: string): Dispose

  /** @stable */
  storage: PluginStorage
  /**
   * 访问外部服务。只能访问 meta.permissions 里声明的域名，不能访问知乎自己的域名，不携带知乎的 Cookie。
   * @experimental
   */
  fetch(url: string, init?: FetchInit): Promise<FetchResponse>
  /** @stable */
  log: Logger
}

// ---------- 页面 ----------

export type PageType =
  | 'home' // 首页推荐
  | 'follow' // 关注
  | 'hot' // 热榜
  | 'question' // 问题页
  | 'answer' // 单个回答页
  | 'article' // 专栏文章
  | 'search' // 搜索
  | 'people' // 用户主页
  | 'collection' // 收藏夹
  | 'pin' // 想法
  | 'topic' // 话题
  | 'video' // 视频
  | 'other'

export interface PageInfo {
  type: PageType
  url: string
  /** 路由参数，如问题页 { questionId: '123' }，回答页 { questionId: '123', answerId: '456' } */
  params: Record<string, string>
}

export interface PageContext {
  page: PageInfo
  /** 离开这个页面时中止 */
  signal: AbortSignal
}

// ---------- 渲染钩子的上下文 ----------

// biome-ignore lint/suspicious/noConfusingVoidType: 回调可以不返回值，也可以返回清理函数；改成 undefined 会拒绝普通的 () => void 函数
export type Render = (container: HTMLElement) => void | Dispose

export interface ItemUI {
  /** 在标题旁（评论是作者名旁）显示一个小标签 */
  badge(text: string, options?: { tone?: 'info' | 'warn' | 'muted'; title?: string }): Dispose
  /** 折叠成一行"已折叠：原因"，用户点击可以展开 */
  fold(reason: string): Dispose
  /** 在操作栏（赞同、评论等按钮所在的一行）添加按钮 */
  addAction(action: { label: string; title?: string; onClick: () => void }): Dispose
  /**
   * 在正文之前或之后挂载自定义界面（位于 Shadow DOM 中）。
   * @experimental
   */
  mount(position: 'before' | 'after', render: Render): Dispose
}

export interface ItemContext {
  page: PageInfo
  /** 元素被移除、离开页面或插件停用时中止 */
  signal: AbortSignal
  ui: ItemUI
  /**
   * 原始 DOM 元素。逃生口，不保证跨版本稳定。
   * @unstable
   */
  el: HTMLElement
}

export interface ContentContext extends ItemContext {
  /** 对这块内容的操作 */
  handle: ContentHandle
}

/** @experimental */
export interface ContentHandle {
  readonly data: Content
  /** 展开全文（使用知乎自己的"阅读全文"） */
  expand(): void
  /** 收起 */
  collapse(): void
  /** 滚动到这块内容 */
  scrollIntoView(): void
  /** 是否在视口内 */
  isVisible(): boolean
}

// ---------- 命令与快捷键 ----------

export interface Command {
  /** 在命令面板里显示的标题 */
  title: string
  /** 额外的搜索关键词 */
  keywords?: string[]
  /** 只在这些页面可用；省略表示所有页面 */
  when?: PageType[]
  run: () => void | Promise<void>
}

export interface ShortcutOptions {
  /** 在设置页和快捷键帮助里显示的说明 */
  description: string
  when?: PageType[]
}

// ---------- 设置 ----------

export type SettingSpec =
  | { type: 'boolean'; label: string; default: boolean; description?: string }
  | {
      type: 'number'
      label: string
      default: number
      min?: number
      max?: number
      step?: number
      description?: string
    }
  | { type: 'string'; label: string; default: string; placeholder?: string; description?: string }
  /** 多行文本 */
  | { type: 'text'; label: string; default: string; description?: string }
  /** options 是"值 → 显示文字" */
  | { type: 'select'; label: string; default: string; options: Record<string, string>; description?: string }
  /** 字符串列表 */
  | { type: 'list'; label: string; default: string[]; placeholder?: string; description?: string }
  | { type: 'color'; label: string; default: string; description?: string }

/** 一个设置项的值类型。 */
export type SettingValue<S extends SettingSpec> = S extends { type: 'boolean' }
  ? boolean
  : S extends { type: 'number' }
    ? number
    : S extends { type: 'list' }
      ? string[]
      : string

/** 根据 meta.settings 推导每个设置项的值类型；没有声明设置项时，值可能是任意一种设置类型。 */
export type SettingsOf<M> = M extends { settings: infer S extends Record<string, SettingSpec> }
  ? { [K in keyof S]: SettingValue<S[K]> }
  : Record<string, boolean | number | string | string[]>

export interface Settings<S> {
  /** 同步读取。插件激活前宿主已经加载好设置，可以直接在过滤函数里用 */
  get<K extends keyof S>(key: K): S[K]
  /** 修改设置，例如"屏蔽作者"按钮把用户加入列表 */
  set<K extends keyof S>(key: K, value: S[K]): Promise<void>
  /** 设置变化时调用：用户在设置页修改、导入数据包、其他标签页修改等 */
  onChange(handler: (changed: Partial<S>) => void): Dispose
}

// ---------- 界面 ----------

export type GlobalSlot =
  | 'toolbar' // 右下角的浮动工具栏
  | 'sidebar' // 右侧栏顶部（页面有右侧栏时）
  | 'overlay' // 覆盖整个页面的层，适合阅读模式这类全屏视图

export interface GlobalUI {
  /** 轻提示 */
  toast(message: string, options?: { tone?: 'info' | 'success' | 'warn' | 'error'; duration?: number }): void
  /** 确认对话框 */
  confirm(message: string, options?: { okText?: string; cancelText?: string }): Promise<boolean>
  /** 在全局挂载点挂载自定义界面（位于 Shadow DOM 中），直到调用返回的 Dispose 或插件停用 */
  mount(slot: GlobalSlot, render: Render): Dispose
}

// ---------- 存储、网络、日志 ----------

/** 每个插件独立的键值存储，数据只保存在本机，值必须能被 JSON 序列化。 */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

/** 允许 z.fetch 访问的域名，如 'net:api.example.com'；'net:*.example.com' 匹配所有子域名。 */
export type Permission = `net:${string}`

export interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number
}

export interface FetchResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
}

/** 输出带插件前缀，可以在插件管理页查看。 */
export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

// ---------- 数据模型 ----------
// 带 ? 的字段在部分页面上可能拿不到，插件必须处理缺失的情况。时间都是毫秒时间戳。

export interface Author {
  id: string
  /** 个人主页地址里的标识，如 /people/xxx 中的 xxx */
  urlToken?: string
  name: string
  /** 一句话介绍 */
  headline?: string
  avatarUrl?: string
  isOrg?: boolean
  isAnonymous?: boolean
}

interface ContentBase {
  id: string
  url: string
  /** 卡片上显示的标题：回答是所属问题的标题；想法可能是空字符串 */
  title: string
  /** 纯文本摘要 */
  excerpt?: string
  author?: Author
  createdAt?: number
  updatedAt?: number
  voteupCount?: number
  commentCount?: number
  /** 是否为付费内容（盐选等），只用于显示和屏蔽 */
  isPaid?: boolean
}

export interface Answer extends ContentBase {
  type: 'answer'
  question: { id: string; title: string }
  /** 正文 HTML，页面拿到了全文时才有 */
  html?: string
  /** 正文字数 */
  wordCount?: number
}

export interface Article extends ContentBase {
  type: 'article'
  column?: { id: string; title: string }
  html?: string
  wordCount?: number
}

export interface Question extends ContentBase {
  type: 'question'
  answerCount?: number
  followerCount?: number
  /** 问题描述 HTML */
  detailHtml?: string
}

export interface Pin extends ContentBase {
  type: 'pin'
  /** 想法正文（纯文本） */
  text?: string
}

export interface Video extends ContentBase {
  type: 'video'
  /** 时长（秒） */
  duration?: number
}

export type Content = Answer | Article | Question | Pin | Video

export interface FeedItem {
  /** 信息流条目 id，不一定等于内容 id */
  id: string
  /** content：普通内容；ad：广告；promotion：推广、活动等；other：无法识别 */
  kind: 'content' | 'ad' | 'promotion' | 'other'
  content?: Content
  /** 推荐理由，如"你关注的人赞同了该回答" */
  reason?: string
}

export interface SearchResult {
  id: string
  kind: 'content' | 'ad' | 'other'
  content?: Content
}

export interface Comment {
  id: string
  author?: Author
  /** 纯文本内容 */
  text: string
  html?: string
  createdAt?: number
  likeCount?: number
  /** 父评论 id；没有表示一级评论 */
  parentId?: string
  /** 回复的对象 */
  replyTo?: Author
  /** 评论所属的内容 */
  target?: { type: Content['type']; id: string }
}
