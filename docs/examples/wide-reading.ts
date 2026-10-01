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
