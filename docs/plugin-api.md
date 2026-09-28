# 插件 API（草案 v0）

> **状态**：草案，1.0 之前随时可能调整。宿主（`packages/core`）和知乎适配层（`packages/adapter-zhihu`）已经实现了本文档的大部分内容，官方插件"屏蔽"就是用它写的；`z.fetch` 计划在 M2 提供，目前调用会报错。
> 对应 `meta.api = 1`。整体设计见[项目计划](./plan.md)。
> 类型定义以 [`packages/sdk/src/index.ts`](../packages/sdk/src/index.ts) 为准；本文档里的示例在 CI 中会对照它做类型检查。

这份文档既写给插件作者，也写给帮用户写插件的 AI：读完这一份，就应该能写出正确的插件。

## 1. 一分钟上手

一个插件就是一个文件：导出 `meta`（插件信息）和一个默认函数。默认函数接收 `z`，通过它注册你想要的功能。

```ts
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'hide-videos',
  name: '隐藏视频',
  version: '1.0.0',
  api: 1,
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  z.filter('feed', item => item.content?.type !== 'video')
}
```

宿主会在每个知乎页面上激活这个插件，首页、关注等信息流里的视频在渲染前就会被去掉。停用插件时，宿主会自动撤销它注册的一切。

## 2. 插件文件

### 2.1 格式

- 一个 `.ts` 或 `.js` 文件，使用 ES module 语法。
- `export const meta`：插件信息，**必须是纯字面量**：不能引用变量、调用函数，也不能在模板字符串里插值。可以在末尾加 `satisfies PluginMeta` 获得类型检查。安装器会在**不执行代码**的情况下解析它。
- `export default function (z) { … }`：插件入口，每个标签页执行一次，可以返回一个清理函数。
- 单文件插件不能 `import` 运行时依赖（`import type` 可以）。需要依赖的插件请先打包成单文件再发布，插件项目模板已经配置好打包。

安装或保存时，扩展会在本地把 TS / ESM 转译成可执行脚本，不改变插件的行为。

### 2.2 meta

```ts
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
  /** 所需权限，见第 12 节。省略表示不访问任何外部网络 */
  permissions?: Permission[]
  /** 设置项定义，宿主据此自动生成设置界面，见第 9 节 */
  settings?: Record<string, SettingSpec>
}
```

## 3. 生命周期

1. 页面加载时，宿主依次激活已启用的插件：先加载它的设置，再调用默认函数。
2. 插件在默认函数里注册钩子、命令、快捷键、样式等。默认函数应该尽快返回，不要在里面做耗时的事。默认函数也可以是 `async` 函数，它最终返回的清理函数同样会被调用。
3. 知乎是单页应用，切换页面**不会**重新执行默认函数。需要按页面做事时，使用 `z.on('page', …)`。
4. 插件被停用、重载或因出错被熔断时，宿主会撤销它注册的一切，并调用它返回的清理函数（如果有）。

所有注册方法都返回一个 `Dispose` 函数，可以用来提前撤销；不调用也没关系，宿主会兜底。

## 4. API 总览

```ts
export type Dispose = () => void

export interface PluginAPI<M extends PluginMeta = PluginMeta> {
  readonly meta: M

  // 页面（第 5 节）
  page(): PageInfo

  // 事件：页面切换（第 5 节）；渲染钩子，渲染后（第 7 节）
  on(event: 'page', handler: (page: PageInfo, ctx: PageContext) => void): Dispose
  on(event: 'content', handler: (content: Content, ctx: ContentContext) => void): Dispose
  on(event: 'comment', handler: (comment: Comment, ctx: ItemContext) => void): Dispose

  // 过滤：渲染前（第 6 节）
  filter(kind: 'feed', fn: (item: FeedItem) => boolean): Dispose
  filter(kind: 'answers', fn: (answer: Answer) => boolean): Dispose
  filter(kind: 'comments', fn: (comment: Comment) => boolean): Dispose
  filter(kind: 'search', fn: (result: SearchResult) => boolean): Dispose

  // 已识别的内容（第 7.3 节）
  contents: {
    all(): ContentHandle[]
    current(): ContentHandle | undefined
  }

  // 命令与快捷键（第 8 节）
  registerCommand(id: string, command: Command): Dispose
  registerShortcut(keys: string, run: () => void, options: ShortcutOptions): Dispose

  // 设置（第 9 节）
  settings: Settings<SettingsOf<M>>

  // 界面与样式（第 10 节）
  ui: GlobalUI
  addStyle(css: string): Dispose

  // 存储（第 11 节）、网络（第 12 节）、日志（第 15 节）
  storage: PluginStorage
  fetch(url: string, init?: FetchInit): Promise<FetchResponse>
  log: Logger
}
```

`SettingsOf<M>` 根据 `meta.settings` 推导出每个设置项的值类型，所以入口函数的参数建议写成 `PluginAPI<typeof meta>`。

## 5. 页面

```ts
export type PageType =
  | 'home'        // 首页推荐
  | 'follow'      // 关注
  | 'hot'         // 热榜
  | 'question'    // 问题页
  | 'answer'      // 单个回答页
  | 'article'     // 专栏文章
  | 'search'      // 搜索
  | 'people'      // 用户主页
  | 'collection'  // 收藏夹
  | 'pin'         // 想法
  | 'topic'       // 话题
  | 'video'       // 视频
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
```

`z.page()` 返回当前页面。`z.on('page')` 在插件激活时对当前页面触发一次，之后每次切换页面再触发；插件稍后才注册的页面钩子，也会马上收到当前页面。同一个页面只会交给同一个钩子一次。只和当前页面有关的资源，用 `ctx.signal` 清理：

```ts
z.on('page', (page, ctx) => {
  if (page.type !== 'question') return
  const dispose = z.ui.mount('sidebar', el => {
    el.textContent = `问题 ${page.params.questionId}`
  })
  ctx.signal.addEventListener('abort', dispose)
})
```

## 6. 过滤（渲染前）

过滤函数决定一条数据是否出现在页面上：返回 `true` 保留，返回 `false` 去掉。

| kind | 作用范围 | 参数类型 |
|---|---|---|
| `feed` | 首页推荐、关注、热榜等信息流 | `FeedItem` |
| `answers` | 问题页的回答列表 | `Answer` |
| `comments` | 评论区（含子评论） | `Comment` |
| `search` | 搜索结果 | `SearchResult` |

```ts
const words = ['营销', '广告']
z.filter('feed', item => {
  if (item.kind === 'ad') return false
  const title = item.content?.title ?? ''
  return !words.some(w => title.includes(w))
})
```

规则：

- **必须是同步的纯函数**：不能 `await`，不要读写 DOM，只依赖传入的数据和 `z.settings`。
- 多个插件的过滤函数同时生效：任何一个返回 `false`，这条数据就会被去掉。
- 对后续加载的数据，宿主在知乎渲染**之前**删除；对首屏已经渲染的内容，宿主隐藏对应的元素。插件不需要区分这两种情况。
- 设置变化后，宿主会对页面上已有的内容重新运行过滤函数。
- 一页数据里的内容全部被过滤时，宿主不会把它们从数据里删掉，而是等知乎渲染出来后，在页面上把它们折叠成一行"已折叠：已过滤"（点击可以展开）；广告等非内容条目照样去掉。原因是 M0 发现：整页被删空时，知乎会不停地请求下一页。折叠后的条目仍然占着页面高度，知乎按平时的节奏加载。
- 想"折叠并显示原因"而不是直接去掉，请在渲染钩子里用 `ctx.ui.fold()`（第 7 节）。
- 过滤函数抛出异常时，按返回 `true`（保留）处理，不会误删内容。

## 7. 渲染钩子（渲染后）

### 7.1 事件

- `z.on('content', handler)`：页面上每出现一块内容就调用一次，包括信息流卡片、回答、文章、想法、视频，以及问题页顶部的问题本身。用 `content.type` 区分类型。
- `z.on('comment', handler)`：每条评论出现时调用。

```ts
z.on('content', (content, ctx) => {
  if (content.type === 'answer' && (content.voteupCount ?? 0) >= 10_000) {
    ctx.ui.badge('万赞')
  }
})
```

注册渲染钩子时，页面上已经有的内容会补发给它，所以插件晚启用、热重载后也不会漏掉内容；同一块内容只会交给同一个钩子一次。知乎重新渲染一块内容（元素被替换）时，会对新元素再调用一次，所以处理函数要能安全地重复执行。元素被移除后，插件添加的界面元素会被清理，`ctx.signal` 中止。

### 7.2 上下文

```ts
export interface ItemContext {
  page: PageInfo
  /** 元素被移除、离开页面或插件停用时中止 */
  signal: AbortSignal
  ui: ItemUI
  /** @unstable 原始 DOM 元素。逃生口，不保证跨版本稳定 */
  el: HTMLElement
}

export interface ContentContext extends ItemContext {
  /** 对这块内容的操作，见 7.3 节 */
  handle: ContentHandle
}

export interface ItemUI {
  /** 在标题旁（评论是作者名旁）显示一个小标签 */
  badge(text: string, options?: { tone?: 'info' | 'warn' | 'muted'; title?: string }): Dispose
  /** 折叠成一行"已折叠：原因"，用户点击可以展开 */
  fold(reason: string): Dispose
  /** 在操作栏（赞同、评论等按钮所在的一行）添加按钮 */
  addAction(action: { label: string; title?: string; onClick: () => void }): Dispose
  /** 在正文之前或之后挂载自定义界面，见 10.2 节 */
  mount(position: 'before' | 'after', render: Render): Dispose
}

export type Render = (container: HTMLElement) => void | Dispose
```

### 7.3 已识别的内容

```ts
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
```

- `z.contents.all()`：当前页面上已识别的全部内容，按在页面上的顺序排列。
- `z.contents.current()`：视口中最靠上的一块内容，适合做键盘导航。

```ts
z.registerShortcut('j', () => {
  const list = z.contents.all()
  const current = z.contents.current()
  const i = current ? list.findIndex(h => h.data.id === current.data.id) : -1
  list[i + 1]?.scrollIntoView()
}, { description: '下一条内容' })
```

## 8. 命令与快捷键

```ts
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
```

```ts
const collapseAll = () => z.contents.all().forEach(h => h.collapse())

z.registerCommand('collapse-all', { title: '收起全部回答', when: ['question', 'answer'], run: collapseAll })
z.registerShortcut('shift+c', collapseAll, { description: '收起全部回答', when: ['question', 'answer'] })
```

- 命令出现在宿主提供的命令面板里，命令面板的快捷键可以在设置中修改。命令 `id` 在插件内唯一（重复注册会报错），宿主会自动加上插件 id 作为前缀。
- 快捷键写法：`'j'`、`'shift+j'`、`'mod+enter'`（`mod` 在 macOS 上是 ⌘，其他系统是 Ctrl），按键序列写成 `'g g'`。修饰键有 `mod`、`ctrl`、`alt`、`shift`、`meta`；除单个字符外，还支持 `enter`、`escape`、`space`、`tab`、`backspace`、`delete`、方向键 `up` / `down` / `left` / `right`、`pageup`、`pagedown`、`home`、`end`、`f1`～`f12`。写法不对时，注册会报错。
- 焦点在输入框、文本框或可编辑区域时，快捷键不触发。
- 多个插件绑定同一个快捷键时，先注册的生效，后注册的在设置页显示冲突提示；用户可以在设置页改键。

## 9. 设置

在 `meta.settings` 里声明设置项，宿主会自动生成设置界面，并负责保存。

```ts
export type SettingSpec =
  | { type: 'boolean'; label: string; default: boolean; description?: string }
  | { type: 'number'; label: string; default: number; min?: number; max?: number; step?: number; description?: string }
  | { type: 'string'; label: string; default: string; placeholder?: string; description?: string }
  | { type: 'text'; label: string; default: string; description?: string }
  | { type: 'select'; label: string; default: string; options: Record<string, string>; description?: string }
  | { type: 'list'; label: string; default: string[]; placeholder?: string; description?: string }
  | { type: 'color'; label: string; default: string; description?: string }

export interface Settings<S> {
  /** 同步读取。插件激活前宿主已经加载好设置，可以直接在过滤函数里用 */
  get<K extends keyof S>(key: K): S[K]
  /** 修改设置，例如"屏蔽作者"按钮把用户加入列表 */
  set<K extends keyof S>(key: K, value: S[K]): Promise<void>
  /** 设置变化时调用：用户在设置页修改、导入数据包、其他标签页修改等 */
  onChange(handler: (changed: Partial<S>) => void): Dispose
}
```

`text` 是多行文本，`select` 的 `options` 是"值 → 显示文字"，`list` 是字符串列表。`get` 读到的值是只读的（比如不能直接往列表里 `push`），要修改请用 `set`；保存下来的值不符合定义时，宿主会改用默认值。

示例：一个带"屏蔽作者"按钮的插件。

```ts
import type { Author, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'block-authors',
  name: '屏蔽作者',
  version: '1.0.0',
  api: 1,
  settings: {
    authors: { type: 'list', label: '已屏蔽的作者（个人主页标识）', default: [] },
  },
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  const isBlocked = (author?: Author) =>
    !!author?.urlToken && z.settings.get('authors').includes(author.urlToken)

  z.filter('feed', item => !isBlocked(item.content?.author))
  z.filter('answers', answer => !isBlocked(answer.author))

  z.on('content', (content, ctx) => {
    const author = content.author
    const token = author?.urlToken
    if (!author || !token) return
    ctx.ui.addAction({
      label: '屏蔽作者',
      onClick: async () => {
        if (!(await z.ui.confirm(`屏蔽 ${author.name}？`))) return
        await z.settings.set('authors', [...z.settings.get('authors'), token])
        z.ui.toast(`已屏蔽 ${author.name}`)
      },
    })
  })
}
```

## 10. 界面与样式

### 10.1 全局界面

```ts
export interface GlobalUI {
  /** 轻提示 */
  toast(message: string, options?: { tone?: 'info' | 'success' | 'warn' | 'error'; duration?: number }): void
  /** 确认对话框 */
  confirm(message: string, options?: { okText?: string; cancelText?: string }): Promise<boolean>
  /** 在全局挂载点挂载自定义界面 */
  mount(slot: GlobalSlot, render: Render): Dispose
}

export type GlobalSlot =
  | 'toolbar'   // 右下角的浮动工具栏
  | 'sidebar'   // 右侧栏顶部（页面有右侧栏时）
  | 'overlay'   // 覆盖整个页面的层，适合阅读模式这类全屏视图
```

### 10.2 挂载点

`mount()` 会给你一个容器元素，它位于 Shadow DOM 中：

- 知乎的样式影响不到你的界面，你的样式也不会漏到知乎页面上。要给界面加样式，直接在容器里放 `<style>`。
- 可以用原生 DOM 或任何小型 UI 库渲染。
- 内容上的挂载点（`ctx.ui.mount`）随内容元素一起清理。
- 全局挂载点（`z.ui.mount`）一直保留，直到调用返回的 `Dispose` 或插件停用。只想在某类页面显示时，在 `z.on('page')` 里挂载，并用 `ctx.signal` 撤销（见第 5 节的例子）。
- 页面没有右侧栏时，`sidebar` 挂载点放在右下角的工具栏里。
- 标签、按钮、内容上的挂载点要等知乎前端完成页面激活之后才会出现在页面上（通常不到一秒）；折叠没有这个限制，会立即生效。
- 挂载点被撤销时，容器会被清空，`render` 返回的 `Dispose`（如果有）会被调用。

### 10.3 样式与主题 token

`z.addStyle(css)` 向知乎页面注入全局样式，插件停用时自动移除。直接针对知乎选择器的样式属于 `unstable`。

主题应当优先设置主题 token（`experimental`）。token 是宿主定义的一组 CSS 变量，由宿主负责映射到知乎页面上：

```ts
z.addStyle(`
  :root {
    --zb-font-family: "LXGW WenKai", serif;
    --zb-content-width: 800px;
  }
`)
```

首批 token（草案）：

| token | 含义 |
|---|---|
| `--zb-font-family` | 正文字体 |
| `--zb-font-size` | 正文字号 |
| `--zb-line-height` | 正文行高 |
| `--zb-content-width` | 主栏宽度 |
| `--zb-color-bg` | 页面背景 |
| `--zb-color-surface` | 卡片背景 |
| `--zb-color-text` | 正文颜色 |
| `--zb-color-text-secondary` | 次要文字颜色 |
| `--zb-color-accent` | 强调色（链接、按钮） |
| `--zb-color-border` | 分割线与边框 |

没有设置的 token 保持知乎原样。

## 11. 存储

每个插件有独立的键值存储，值必须能被 JSON 序列化。

```ts
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}
```

- 数据只保存在本机。
- 键是 1～256 个字符的字符串。
- 每个插件默认配额 5 MB（待定）。
- 卸载插件时，用户可以选择是否同时删除它的数据。

设置项用 `z.settings`，其他数据（例如阅读记录、缓存）用 `z.storage`。

## 12. 网络与权限

### 12.1 z.fetch

插件访问外部服务（例如调用 AI 接口）必须通过 `z.fetch`，并在 `meta.permissions` 里声明域名：

```ts
export const meta = {
  id: 'summary',
  name: '回答摘要',
  version: '0.1.0',
  api: 1,
  permissions: ['net:api.example.com'],
} satisfies PluginMeta

// 在入口函数里：
const res = await z.fetch('https://api.example.com/v1/summarize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text }),
})
const data = await res.json<{ summary: string }>()
```

```ts
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
```

- 请求由扩展后台发出，**不携带知乎的 Cookie**，也不受页面跨域限制。
- 只能访问声明过的域名。安装插件时用户会看到这些域名，浏览器也会要求确认对应的访问权限。
- `z.fetch` **不能访问知乎自己的域名**。插件需要的知乎数据，请通过过滤函数和渲染钩子获得。

### 12.2 权限

```ts
/** 允许 z.fetch 访问的域名，如 'net:api.example.com'；'net:*.example.com' 匹配 example.com 本身及其所有子域名 */
export type Permission = `net:${string}`
```

目前只有网络权限。下载、剪贴板等权限会在出现真实需求时再加。

### 12.3 能管住什么，管不住什么

在页面里运行的代码，理论上可以绕过 `z.fetch`，直接操作页面或发起请求，这在技术上无法完全禁止。所以：`z.fetch` 的权限是强制执行的；对页面的操作是插件作者的承诺，靠源码透明和审核把关。官方插件索引会拒收以下插件：

- 代码经过混淆或压缩，且不提供源码；
- 没有声明就向外部发送数据；
- 自动或批量执行点赞、关注、评论、私信等写操作；
- 批量抓取内容；
- 绕过付费内容的限制。

## 13. 数据模型

带 `?` 的字段在部分页面上可能拿不到，插件必须处理缺失的情况。时间都是毫秒时间戳。

```ts
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

## 14. 稳定性与版本

每个 API 属于以下级别之一。下表是 1.0 正式发布后的承诺；草案阶段一切都可能调整。

- `stable`：大版本内保证兼容。
- `experimental`：可能在小版本中调整，更新日志会说明。
- `unstable`：逃生口，不作任何保证。

| API | 级别 |
|---|---|
| `meta`、生命周期、`page()`、`on('page')` | stable |
| `filter` | stable |
| `on('content')`、`on('comment')`、`ctx.ui.badge` / `fold` / `addAction` | stable |
| `registerCommand`、`registerShortcut` | stable |
| `settings`、`storage`、`log` | stable |
| `contents`、`ContentHandle` | experimental |
| `ui.toast` / `confirm` / `mount`、`ctx.ui.mount` | experimental |
| 主题 token | experimental |
| `fetch` | experimental |
| `ctx.el`、直接针对知乎选择器的 `addStyle` | unstable |

- 只使用 `stable` API 的插件，在插件列表中标为"稳定"。
- `meta.api` 是插件依赖的大版本。宿主同时支持当前大版本和上一个大版本；更早的插件会被停用，并提示升级。
- 大版本内只做新增，不做破坏性修改。
- 新增 API 需要提交 `api-rfc` issue，并说明至少两个真实插件的用例。

## 15. 日志、错误与性能

```ts
export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}
```

- `z.log` 的输出带插件前缀，可以在插件管理页查看。
- 每次调用插件的函数都有异常保护，报错会记录到日志。
- 同一个插件在 1 分钟内报错超过 10 次，宿主会在当前页面停用它并提示（阈值待定）。
- 过滤函数每次调用应在 1 毫秒内完成，渲染钩子应在 5 毫秒内完成；持续超标的插件会在插件管理页显示警告。
- 安全模式：在设置页一键开启后，知乎页面不加载任何插件，用于排查问题。

## 16. 数据包

数据包是某个插件的一份配置预设，用来分享主题、屏蔽列表等，不含代码：

```json
{
  "zbPack": 1,
  "plugin": "filter",
  "name": "示例屏蔽列表",
  "version": "1.0.0",
  "description": "一份示例关键词列表",
  "settings": {
    "keywords": ["关键词一", "关键词二"]
  }
}
```

- `plugin` 是目标插件的 id；`settings` 必须符合该插件 `meta.settings` 的定义，宿主会校验。
- 可以从文件或链接导入。从链接导入的数据包可以订阅，宿主定期检查更新（M3）。
- 导入时，`list` 类型的设置默认合并，其他设置默认覆盖；用户可以在导入前预览变化。

## 17. 示例

### 17.1 清爽信息流

```ts
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

### 17.2 长文折叠

```ts
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
    if (content.type !== 'answer' || content.wordCount === undefined) return
    ctx.ui.badge(`${content.wordCount} 字`, { tone: 'muted' })
    if (content.wordCount >= z.settings.get('minWords')) {
      ctx.ui.fold(`长文，约 ${content.wordCount} 字`)
    }
  })
}
```

### 17.3 阅读模式（简化版）

```ts
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
      font: 18px/1.9 var(--zb-font-family, serif);
      background: var(--zb-color-bg, #fff); color: var(--zb-color-text, #1a1a1a);
    }`
  const article = document.createElement('article')
  article.className = 'reader'
  const title = document.createElement('h1')
  title.textContent = content.title
  const body = document.createElement('div')
  // 知乎提供的正文 HTML；正式的阅读模式插件还要处理懒加载图片等细节
  body.innerHTML = content.html ?? ''
  article.append(title, body)
  container.append(style, article)
}
```

## 18. 让 AI 写插件

把这份文档和你的需求一起交给 AI，例如：

> 请根据下面的插件 API 文档写一个知乎插件：在每个回答的标题旁显示发布日期（格式 YYYY-MM-DD）；如果回答编辑过，再显示"编辑于 YYYY-MM-DD"。只输出一个完整的 TypeScript 文件。
>
> （粘贴文档）

几点建议：

- 要求 AI 只使用文档里的 API，不直接操作知乎的页面结构。
- 要求输出一个完整文件，包含 `meta` 和默认导出。
- 运行出错时，把插件管理页里的日志贴回给 AI，让它修改。

M2 起，仓库会提供一份专门给 AI 阅读的精简指南，包含全部类型定义和示例。

## 19. 待定问题

1. 过滤函数是否需要支持改写数据（例如替换标题），还是只做"保留 / 去掉"？目前倾向于只做保留 / 去掉，改写放在渲染钩子里做。
2. `z.fetch` 是否支持流式响应（AI 接口常用）。
3. 设置是否随浏览器账号同步（浏览器提供的同步空间很小）。
4. 是否提供按 id 查询实体仓库的接口；目前还没有两个以上的真实用例。
5. 命令面板的默认快捷键，需要避开知乎和浏览器已占用的按键。
6. 插件之间是否需要互相通信（目前不支持）。
7. 知乎重新渲染右侧栏等区域时，全局挂载点的具体行为。
8. 问题页的广告不在回答列表里，而是接口响应顶层的 `ad_info`，`filter('answers')` 管不到。是增加 `filter('ads')`，还是把它当作一种特殊条目交给现有过滤函数？
9. 热榜条目（`hot_list_feed`）是卡片结构，不是完整的内容；映射成 `FeedItem` 时，`content` 里哪些字段能保证有值。
