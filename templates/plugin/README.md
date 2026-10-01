# 知乎插件项目模板

用 TypeScript 写一个 [zhihu-browser](https://github.com/FJWangYantao/zhihu-browser) 插件：有类型提示，保存即热重载，打包成单文件发布。

## 开始

```
pnpm install      # 或 npm install
pnpm dev          # 打包并启动本机服务器：http://127.0.0.1:5177/plugin.js
```

1. 在扩展里打开设置页，确认已经打开浏览器的"允许用户脚本"（设置页上有引导）。
2. 设置页 → "安装用户插件" → "或者从链接下载"，填 `http://127.0.0.1:5177/plugin.js`，检查权限和源码后确认安装。
3. 点"开发模式"里的"监听更新"。之后每次保存 `src/index.ts`，已经打开的知乎页面里的插件会自动换成新代码，不用刷新页面。（设置页要保持打开。）

改插件的 `id`、`name`、`version`；`id` 只能用小写字母、数字和连字符，装过的同 id 插件会被更新。

## 文件

| 文件 | 作用 |
|---|---|
| `src/index.ts` | 插件本体：`export const meta`（纯字面量）和默认导出的入口函数 |
| `scripts/build.mjs` | 打包成 `dist/plugin.js`（不压缩，用户安装前能看到完整源码） |
| `scripts/dev.mjs` | 监听文件、打包、提供本机链接 |

## 写法要点

- API 文档：<https://github.com/FJWangYantao/zhihu-browser/blob/main/docs/plugin-api.md>
- 让 AI 帮你写：把 [给 AI 的指南](https://github.com/FJWangYantao/zhihu-browser/blob/main/docs/ai-guide.md) 和你的需求一起交给它。
- `meta` 里不能引用变量、调用函数；需要访问外部网站，在 `meta.permissions` 里写 `'net:api.example.com'`。
- 只用 `stable` 的 API，插件就会在插件列表里标为"稳定"。
- 依赖放进 `dependencies` 就行：打包会把它们合进单文件里。

## 发布

`pnpm build` 之后把 `dist/plugin.js` 发给别人：他们在设置页选择文件，或者你把它放到一个可以直接下载的链接上。
