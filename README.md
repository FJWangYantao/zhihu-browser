# zhihu-browser（暂名）

开源的知乎浏览增强扩展，支持 Chrome、Edge 和 Firefox。

- **核心小而稳定**：知乎改版时只需修复适配层，插件不受影响。
- **一切皆插件**：屏蔽、主题、阅读模式、快捷键都是插件，内置功能和第三方插件用同一套 API。
- **人人能写插件**：从零代码配置，到单文件插件，再到完整插件包；API 足够小，AI 读完文档就能写。
- **安全可信**：开源、最小权限、零遥测，不接触账号密码。

设计理念参考了 [pi](https://github.com/badlogic/pi-mono) 的"小核心 + 可扩展"。

> 当前进度：M0 技术验证已完成，M1 开发中。扩展现在还没有任何功能。

## 文档

- [项目计划](docs/plan.md)：目标、架构、里程碑、风险
- [插件 API 草案](docs/plugin-api.md)：插件怎么写
- [M0 技术验证报告](docs/spike-report.md)：在真实知乎页面上验证了哪些技术前提

## 开发

需要 Node.js 22.12 以上和 pnpm（执行 `corepack enable` 即可使用仓库指定的 pnpm 版本）。

```
pnpm install
pnpm build       # 构建扩展，输出在 apps/extension/.output/chrome-mv3
pnpm lint        # 代码规范（Biome）
pnpm typecheck   # 类型检查，包括 docs/plugin-api.md 里的示例
pnpm test        # 测试（Vitest）
```

构建好的扩展可以在 `chrome://extensions` 里用"加载已解压的扩展程序"加载。CI 每次构建后也会上传扩展，可以在 GitHub Actions 的运行记录里下载。

| 目录 | 内容 |
|---|---|
| `apps/extension` | 浏览器扩展（WXT） |
| `packages/sdk` | 插件 API 的类型定义 |
| `packages/core` | 插件宿主：生命周期、钩子调度、隔离与熔断、设置、存储、权限 |
| `spike/m0-probe` | M0 技术验证用的探针扩展 |

## 许可证与声明

[MIT](LICENSE)。本项目与知乎官方无关。
