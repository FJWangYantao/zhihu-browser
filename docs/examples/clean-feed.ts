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
