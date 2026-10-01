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
