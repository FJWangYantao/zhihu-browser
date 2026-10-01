# 给 AI 的插件编写指南

> 这份文件由 `node scripts/build-ai-guide.mjs` 根据 `packages/sdk/src/index.ts`（类型）和 `docs/examples/`（示例）生成，不要手动修改 `docs/ai-guide.md`；改 `docs/ai-guide.src.md` 或上面两处，再重新生成。
> 面向人的完整说明见 [插件 API 文档](./plugin-api.md)。

## 怎么用

把这份文件**整体**交给 AI，再写上你的需求，例如：

> 请根据上面的指南写一个知乎插件：超过三千字的回答默认折叠，顶部显示字数。只输出一个完整的 TypeScript 文件。

生成的代码保存成 `.ts` 文件，在 zhihu-browser 设置页的"安装用户插件"里粘贴或选择文件即可；安装前会显示权限和完整源码，确认之后才会运行。出错时，把知乎页面上命令面板（Ctrl+K / ⌘K）里"插件状态与日志"显示的日志贴回给 AI，让它修改。

---

以下是写给 AI 的内容。

## 你的任务

为 zhihu-browser 浏览器扩展写一个**知乎插件**：一个 TypeScript 文件，只使用下面"类型定义"里的 API。**只输出这一个文件的完整代码**，不要输出解释，不要拆成多个文件。

## 文件结构（必须遵守）

```ts
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'my-plugin', // 小写字母、数字和连字符
  name: '插件名称',
  version: '1.0.0',
  api: 1,
  // description、settings、permissions 按需添加
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  // 在这里用 z 注册：过滤、钩子、命令、快捷键、样式、界面……
}
```

1. `meta` **必须是纯字面量**：不能引用变量、调用函数、使用展开语法、模板字符串插值。安装器不执行代码就读取它。
2. 默认导出一个函数，参数类型写 `PluginAPI<typeof meta>`，这样 `z.settings.get('键名')` 有正确的类型。入口函数每个标签页执行一次，可以是 `async`，可以返回一个清理函数。
3. **只能 `import type`**。不能 `import` 任何运行时依赖，不能 `require`，不能用动态 `import()`。要用的小工具函数自己写在文件里。
4. 文件顶层只放常量和函数定义，不要在顶层做有副作用的事；所有行为都在入口函数里通过 `z` 注册。

## 规则

- **优先用数据，不要碰页面结构。** 去掉内容用 `z.filter`（在知乎渲染之前，基于数据）；在内容上加东西用 `z.on('content')` + `ctx.ui`（标签 `badge`、折叠 `fold`、按钮 `addAction`、挂载 `mount`）。只有这些做不到时，才用 `ctx.el`（原始 DOM，不保证稳定）或 `z.addStyle` 里写知乎的选择器。**不要使用 `css-` 开头的自动生成类名。**
- **过滤函数必须是同步的纯函数**，每次调用 1 毫秒内完成，返回 `true` 保留、`false` 去掉；不能 `await`，不能访问网络。
- 知乎是单页应用：切换页面**不会**重新执行入口函数。按页面做事用 `z.on('page', …)`，用 `ctx.signal` 在离开页面时清理。
- 通过 `z` 注册的东西（过滤、钩子、命令、快捷键、样式、界面）在插件停用时自动撤销，不需要手动清理；自己 `addEventListener`、`setInterval` 的要在清理函数或 `ctx.signal` 的 abort 事件里撤销。
- 设置项写在 `meta.settings` 里（设置页自动生成表单），用 `z.settings.get(key)` 同步读取，`z.settings.onChange` 监听变化，`z.settings.set` 修改。不要自己做设置界面。
- 数据保存用 `z.storage`（异步，值要能 JSON 序列化）。
- 网络只能用 `z.fetch`，并且必须在 `meta.permissions` 里声明域名，如 `permissions: ['net:api.example.com']`（`'net:*.example.com'` 匹配子域名）。**不能访问知乎自己的域名**；不携带知乎的 Cookie。不要把用户的知乎内容发给第三方，除非需求明确要求，并且在 `description` 里说清楚。
- 生命周期细节：`ctx.ui.badge` / `fold` / `addAction` / `mount` 返回的 `Dispose` 可以随时调用，调用之后可以再重新添加；设置变了需要更新界面时，先撤销旧的、再按新设置添加（见示例 `low-vote-fold.ts`）。`z.settings.onChange` 的回调被调用时，`z.settings.get` 已经能读到新值。`ctx.signal` 在这块内容的元素被移除（或被知乎替换，替换后会再用新元素调用一次钩子）、离开页面、插件停用时一定会 abort，要跟踪的内容列表在这时清理。没有写 `when` 的命令和快捷键在所有页面上都可用，只想在某类页面可用就写 `when: ['answer', 'article']`。
- 字段缺失：数据模型里带 `?` 的字段在部分页面上拿不到，必须处理 `undefined`。时间都是毫秒时间戳。
- 命令（`registerCommand`）出现在命令面板里；快捷键（`registerShortcut`）焦点在输入框时不触发，写法如 `'j'`、`'shift+j'`、`'mod+enter'`、`'g g'`，`mod` 在 macOS 上是 ⌘、其他系统是 Ctrl。给命令和快捷键都写清楚 `title` / `description`。
- 不要读写 `localStorage` / `document.cookie`，不要读知乎页面脚本里的变量（运行环境与页面脚本隔离，也读不到）。不要使用 `eval` 和 `new Function`。
- **不要做自动化**：不要替用户点赞、关注、评论、发请求到知乎，也不要模拟点击去触发知乎的功能。这会让用户的账号被风控。
- 出错时用 `z.log.error(...)` 记录，需要让用户知道时用 `z.ui.toast(...)`；不要让异常抛到入口函数外面。
- 代码用中文注释写清楚每一步在做什么；插件名称、说明、设置项标签都用中文。

## 常见错误

| 错误写法 | 正确写法 |
|---|---|
| `const id = 'x'; export const meta = { id, … }` | `meta` 里直接写字面量：`id: 'x'` |
| `import _ from 'lodash'` | 自己写，或者只用 `import type` |
| `z.filter('feed', async item => …)` | 过滤函数是同步的 |
| `document.querySelector('.css-1a2b3c')` | 用 `z.on('content', (c, ctx) => …)` 和 `ctx.ui` |
| 在 `z.on('content')` 里 `setInterval` 不清理 | 用 `ctx.signal.addEventListener('abort', …)` 清理 |
| `fetch('https://…')` | `z.fetch('https://…')`，并在 `meta.permissions` 里声明域名 |
| 在入口函数里直接读 `z.contents.all()` 当作"所有内容" | 内容是陆续出现的，用 `z.on('content', …)` |
| 把设置存进 `z.storage` 再自己做界面 | 写进 `meta.settings`，设置页自动生成 |
| `export default function (z: PluginAPI)` | `PluginAPI<typeof meta>`，设置的类型才对 |

## 提交前自查

- [ ] 只有一个文件，包含 `export const meta`（纯字面量）和默认导出的函数。
- [ ] 没有运行时 `import`；`id` 只含小写字母、数字、连字符。
- [ ] 过滤函数同步；带 `?` 的字段做了缺失处理。
- [ ] 用到网络就声明了 `permissions`；没有访问知乎域名。
- [ ] 没有自动化操作，没有使用 `css-` 开头的类名。

## 类型定义

下面是 `@zhihu-browser/sdk` 的全部类型（`@stable` / `@experimental` / `@unstable` 标注了稳定性）：

```ts
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

// biome-ignore lint/suspicious/noConfusingVoidType: 回调可以不返回值，也可以返回清理函数；改成 undefined 会拒绝普通的 () => void 函数
type EntryResult = void | Dispose

/** 插件入口：插件文件的默认导出。每个标签页执行一次，可以返回一个清理函数；也可以是 async 函数。 */
export type PluginEntry<M extends PluginMeta = PluginMeta> = (z: PluginAPI<M>) => EntryResult | Promise<EntryResult>

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

/** 允许 z.fetch 访问的域名，如 'net:api.example.com'；'net:*.example.com' 匹配 example.com 本身及其所有子域名。 */
export type Permission = `net:${string}`

export interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** 超时时间（毫秒），默认 30000，最长 120000 */
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
```

## 示例

每个示例都是完整、可以直接安装的插件，并且在 CI 里经过类型检查和安装器解析。

### author-date.ts

```ts
// 在每个回答的标题旁显示发布日期，编辑过的再显示"编辑于"。时间都是毫秒时间戳。
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'answer-dates',
  name: '回答日期',
  version: '1.0.0',
  api: 1,
  description: '在回答标题旁显示发布日期，编辑过的显示编辑日期',
} satisfies PluginMeta

const day = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function (z: PluginAPI<typeof meta>) {
  z.on('content', (content, ctx) => {
    if (content.type !== 'answer') return
    if (content.createdAt) ctx.ui.badge(day(content.createdAt), { tone: 'muted' })
    if (content.createdAt && content.updatedAt && content.updatedAt - content.createdAt > 60_000) {
      ctx.ui.badge(`编辑于 ${day(content.updatedAt)}`, { tone: 'muted' })
    }
  })
}
```

### clean-feed.ts

```ts
// 过滤 + 设置：去掉信息流里的广告和推广，可选隐藏视频。
// 设置项写在 meta.settings 里，设置页会自动生成表单；过滤函数里用 z.settings.get 同步读取，设置改了立即生效。
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'clean-feed',
  name: '清爽信息流',
  version: '1.0.0',
  api: 1,
  description: '去掉信息流里的广告和推广，可选隐藏视频',
  settings: {
    hideVideos: { type: 'boolean', label: '隐藏视频', default: true },
  },
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  z.filter('feed', item => {
    if (item.kind === 'ad' || item.kind === 'promotion') return false
    if (z.settings.get('hideVideos') && item.content?.type === 'video') return false
    return true
  })
}
```

### github-zen.ts

```ts
// 网络：z.fetch 只能访问 meta.permissions 里声明的域名，不能访问知乎自己的域名，不带知乎的 Cookie。
// 安装时用户会看到这个域名，并在浏览器里授权。命令出现在命令面板里（Ctrl+K / ⌘K）。
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'github-zen',
  name: 'GitHub 禅语',
  version: '1.0.0',
  api: 1,
  description: '在命令面板里加一条命令：从 GitHub 取一句话，用提示显示出来',
  permissions: ['net:api.github.com'],
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  z.registerCommand('zen', {
    title: 'GitHub 禅语',
    keywords: ['github', 'zen'],
    run: async () => {
      try {
        const response = await z.fetch('https://api.github.com/zen', { timeout: 10_000 })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        z.ui.toast(await response.text())
      } catch (e) {
        // 网络出错时给用户一个说得清的提示，而不是静默失败
        z.log.error('取禅语失败', e)
        z.ui.toast('取禅语失败，稍后再试', { tone: 'error' })
      }
    },
  })
}
```

### hide-videos.ts

```ts
// 最小的插件：去掉信息流里的视频。
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'hide-videos',
  name: '隐藏视频',
  version: '1.0.0',
  api: 1,
  description: '去掉信息流里的视频，在知乎渲染之前就去掉，不会出现空位',
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  z.filter('feed', item => item.content?.type !== 'video')
}
```

### long-answer-fold.ts

```ts
// 渲染钩子：在每个回答上做事。超过指定字数的回答默认折叠，并在标题旁显示字数。
// ctx.ui 里的标签、折叠、按钮都由宿主放到正确的位置，内容被移除或插件停用时自动清理。
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'long-answer-fold',
  name: '长文折叠',
  version: '1.0.0',
  api: 1,
  description: '超过指定字数的回答默认折叠，并在标题旁显示字数',
  settings: {
    minWords: { type: 'number', label: '折叠阈值（字）', default: 3000, min: 500, step: 500 },
  },
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  z.on('content', (content, ctx) => {
    // 带 ? 的字段在部分页面上可能拿不到，必须处理缺失的情况
    if (content.type !== 'answer' || content.wordCount === undefined) return
    ctx.ui.badge(`${content.wordCount} 字`, { tone: 'muted' })
    if (content.wordCount >= z.settings.get('minWords')) {
      ctx.ui.fold(`长文，约 ${content.wordCount} 字`)
    }
  })
}
```

### low-vote-fold.ts

```ts
// 综合示例：自己记下每块内容上的界面工具（ctx.ui 返回的 Dispose），设置变了、命令触发时撤销并重做。
// 在每个回答的标题旁显示"赞 {赞同数} · 评 {评论数}"，赞同数低于阈值的回答默认折叠；
// 命令"展开所有低赞回答"撤销页面上这类折叠，直到设置再被修改。
// 这份代码是一个只读过 docs/ai-guide.md 的 AI 按需求写出来的（见 packages/remote/test/ai-plugin.test.ts 的验证）。
import type { Dispose, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'low-vote-fold',
  name: '低赞回答折叠',
  version: '1.0.0',
  api: 1,
  description: '在回答标题旁显示赞同数和评论数，赞同数低于设置值的回答默认折叠',
  settings: {
    minVotes: { type: 'number', label: '最低赞同数', default: 10, min: 0, step: 1 },
    foldLow: { type: 'boolean', label: '折叠低赞回答', default: true },
  },
} satisfies PluginMeta

// 页面上每个已显示回答的状态：当前的标签和折叠，以及重新渲染的方法
interface Entry {
  votes: number
  comments: number
  disposeBadge?: Dispose
  disposeFold?: Dispose
  // 用户是否已用命令展开（展开后不再自动折叠，直到设置被修改）
  released: boolean
  render: () => void
}

export default function (z: PluginAPI<typeof meta>) {
  // 当前页面上所有已处理的回答
  const entries = new Set<Entry>()

  z.on('content', (content, ctx) => {
    // 只处理回答；赞同数、评论数可能缺失，缺失按 0 处理
    if (content.type !== 'answer') return

    const entry: Entry = {
      votes: content.voteupCount ?? 0,
      comments: content.commentCount ?? 0,
      released: false,
      render: () => {},
    }

    // 按当前设置重新显示标签和折叠：先撤销旧的，再按新设置添加
    entry.render = () => {
      entry.disposeBadge?.()
      entry.disposeFold?.()
      entry.disposeBadge = undefined
      entry.disposeFold = undefined

      // 标签始终显示
      entry.disposeBadge = ctx.ui.badge(`赞 ${entry.votes} · 评 ${entry.comments}`, { tone: 'muted' })

      // 开关打开、赞同数低于阈值、且用户没有手动展开时才折叠
      const threshold = z.settings.get('minVotes')
      if (z.settings.get('foldLow') && !entry.released && entry.votes < threshold) {
        entry.disposeFold = ctx.ui.fold(`赞同数低于 ${threshold}`)
      }
    }

    entries.add(entry)
    entry.render()

    // 元素被移除、离开页面或插件停用时，不再跟踪这个回答
    ctx.signal.addEventListener('abort', () => {
      entries.delete(entry)
    })
  })

  // 设置在设置页被修改后，立即更新页面上已有的回答（标签和折叠）
  z.settings.onChange(() => {
    for (const entry of entries) {
      entry.released = false // 设置变了，按新设置重新判断
      try {
        entry.render()
      } catch (e) {
        z.log.error('按新设置更新回答失败', e)
      }
    }
  })

  // 命令：撤销当前页面上所有由本插件产生的折叠
  z.registerCommand('expand-low', {
    title: '展开所有低赞回答',
    keywords: ['展开', '低赞', '折叠'],
    run: () => {
      let count = 0
      for (const entry of entries) {
        if (entry.disposeFold) {
          entry.disposeFold()
          entry.disposeFold = undefined
          count++
        }
        entry.released = true
      }
      z.ui.toast(count > 0 ? `已展开 ${count} 个低赞回答` : '当前页面没有被折叠的低赞回答')
    },
  })
}
```

### mute-authors.ts

```ts
// 屏蔽作者：设置里放一个作者名单，过滤函数去掉名单里的人；每块内容上加一个"不再看 TA"按钮，
// 点击后用确认框问一下，再把作者写进设置（z.settings.set）。
import type { Author, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'mute-authors',
  name: '屏蔽作者',
  version: '1.0.0',
  api: 1,
  description: '在内容上加一个"不再看 TA"按钮，名单里的作者的内容在渲染之前就去掉',
  settings: {
    authors: {
      type: 'list',
      label: '屏蔽的作者（用户主页地址里的标识）',
      default: [],
      description: '每行一个，如 /people/xxx 里的 xxx',
    },
  },
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  const muted = (author?: Author) => !!author?.urlToken && z.settings.get('authors').includes(author.urlToken)

  z.filter('feed', item => !muted(item.content?.author))
  z.filter('answers', answer => !muted(answer.author))
  z.filter('comments', comment => !muted(comment.author))

  z.on('content', (content, ctx) => {
    const author = content.author
    if (!author?.urlToken || author.isAnonymous) return
    ctx.ui.addAction({
      label: '不再看 TA',
      title: `屏蔽 ${author.name}`,
      onClick: async () => {
        if (!(await z.ui.confirm(`以后不再看 ${author.name} 的内容？`))) return
        const token = author.urlToken as string
        await z.settings.set('authors', [...z.settings.get('authors'), token])
        z.ui.toast(`已屏蔽 ${author.name}`)
      },
    })
    if (muted(author)) ctx.ui.fold(`已屏蔽 ${author.name}`)
  })
}
```

### simple-reader.ts

```ts
// 全局界面 + 命令 + 快捷键：一个简化的阅读模式。
// z.contents.current() 是屏幕上方的那块内容，正文 HTML 在 data.html 里（页面拿到全文时才有）。
// z.ui.mount('overlay', …) 挂一个覆盖整个页面的层，返回的函数用来关闭。
import type { Answer, Article, PageType, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'simple-reader',
  name: '阅读模式（简化版）',
  version: '0.1.0',
  api: 1,
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  let close: (() => void) | undefined

  function toggle() {
    if (close) {
      close()
      close = undefined
      return
    }
    const target = z.contents.current()?.data
    if (!target || (target.type !== 'answer' && target.type !== 'article') || !target.html) {
      z.ui.toast('当前位置没有可以阅读的全文')
      return
    }
    close = z.ui.mount('overlay', container => render(container, target))
  }

  const when: PageType[] = ['question', 'answer', 'article']
  z.registerCommand('toggle', { title: '打开 / 关闭阅读模式', when, run: toggle })
  z.registerShortcut('r', toggle, { description: '打开 / 关闭阅读模式', when })

  // 切换页面时关闭
  z.on('page', () => {
    close?.()
    close = undefined
  })
}

function render(container: HTMLElement, content: Answer | Article) {
  const style = document.createElement('style')
  style.textContent = `
    .reader {
      min-height: 100vh; box-sizing: border-box;
      max-width: 42em; margin: 0 auto; padding: 48px 24px;
      font: 18px/1.9 serif; background: #fff; color: #1a1a1a;
    }`
  const article = document.createElement('article')
  article.className = 'reader'
  const title = document.createElement('h1')
  title.textContent = content.title
  const body = document.createElement('div')
  // 知乎提供的正文 HTML；正式的阅读模式插件还要先清理一遍（见官方插件 plugins/reader）
  body.innerHTML = content.html ?? ''
  article.append(title, body)
  container.append(style, article)
}
```

### wide-reading.ts

```ts
// 样式：优先设置主题 token（--zb-*），不要直接写知乎的选择器——知乎改版时宿主会更新 token 的映射。
// 这个插件按设置宽屏阅读、调字号，并在系统是暗色时用知乎自带的暗色。
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'wide-reading',
  name: '宽屏阅读',
  version: '1.0.0',
  api: 1,
  description: '加宽主栏、调大字号，系统是暗色时自动用暗色',
  settings: {
    width: { type: 'number', label: '主栏宽度（px）', default: 960, min: 640, max: 1400, step: 20 },
    fontSize: { type: 'number', label: '正文字号（px）', default: 17, min: 14, max: 24 },
  },
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  let remove: (() => void) | undefined
  const apply = () => {
    remove?.() // 先撤销上一次的样式，再按新设置注入
    remove = z.addStyle(`
      :root {
        --zb-content-width: ${z.settings.get('width')}px;
        --zb-font-size: ${z.settings.get('fontSize')}px;
      }
      @media (prefers-color-scheme: dark) {
        :root { --zb-color-scheme: dark; }
      }
    `)
  }
  apply()
  z.settings.onChange(apply)
}
```
