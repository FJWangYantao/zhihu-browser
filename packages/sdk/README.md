# @zhihu-browser/sdk

[zhihu-browser](https://github.com/FJWangYantao/zhihu-browser) 插件 API 的类型定义。**只有类型，没有运行时代码**：插件运行时由扩展提供，这个包用来在写插件时获得代码补全和类型检查。

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

- 插件怎么写：[插件 API 文档](https://github.com/FJWangYantao/zhihu-browser/blob/main/docs/plugin-api.md)
- 让 AI 写插件：[给 AI 的指南](https://github.com/FJWangYantao/zhihu-browser/blob/main/docs/ai-guide.md)
- 插件项目模板：[templates/plugin](https://github.com/FJWangYantao/zhihu-browser/tree/main/templates/plugin)

`meta.api` 是插件依赖的 API 大版本，这个包的版本和它没有对应关系。包里的类型标注了每个 API 的稳定性（`@stable` / `@experimental` / `@unstable`）。

许可：MIT
