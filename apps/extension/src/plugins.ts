import * as declutter from '@zhihu-browser/plugin-declutter'
import * as filter from '@zhihu-browser/plugin-filter'
import * as hdImages from '@zhihu-browser/plugin-hd-images'
import * as info from '@zhihu-browser/plugin-info'
import * as reader from '@zhihu-browser/plugin-reader'
import * as shortcuts from '@zhihu-browser/plugin-shortcuts'
import * as theme from '@zhihu-browser/plugin-theme'
import type { PluginModule } from '@zhihu-browser/sdk'

// 每个插件的设置类型各不相同，放进同一个列表时统一看作 PluginModule（宿主按 meta.settings 校验设置）
const asModule = (plugin: object) => plugin as PluginModule

/** 随扩展打包的官方插件，按加载顺序排列（快捷键冲突时先加载的优先），设置页也按这个顺序显示 */
export const officialPlugins: readonly PluginModule[] = [
  filter,
  theme,
  info,
  shortcuts,
  reader,
  hdImages,
  declutter,
].map(asModule)
