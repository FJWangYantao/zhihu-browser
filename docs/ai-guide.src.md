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
<!-- sdk-types -->
```

## 示例

每个示例都是完整、可以直接安装的插件，并且在 CI 里经过类型检查和安装器解析。

<!-- examples -->
