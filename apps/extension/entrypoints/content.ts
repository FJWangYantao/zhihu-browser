import '@zhihu-browser/adapter-zhihu/styles.css'
import { createAdapter } from '@zhihu-browser/adapter-zhihu'
import { createHost } from '@zhihu-browser/core'
import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { officialPlugins } from '../src/plugins'
import {
  createSettingsBackend,
  createStorageBackend,
  isEnabled,
  PLUGINS_KEY,
  readState,
  SAFE_MODE_KEY,
  type StorageApi,
  toPluginStates,
  watch,
} from '../src/storage'

// 扩展隔离环境（ISOLATED world）：插件宿主、知乎适配层和官方插件从这里启动。
export default defineContentScript({
  matches: ['*://*.zhihu.com/*'],
  runAt: 'document_start',
  // 不向知乎页面 postMessage（WXT 旧的"内容脚本已启动"通知）
  noScriptStartedPostMessage: true,
  async main() {
    // 先创建适配层：打开预隐藏、开始观察页面，插件加载好之前出现的内容先排队
    const adapter = createAdapter()
    const api = browser.storage as unknown as StorageApi
    const state = await readState(api)
    const host = createHost({
      safeMode: state.safeMode,
      services: {
        settings: createSettingsBackend(api),
        storage: createStorageBackend(api),
        fetch: async () => {
          throw new Error('z.fetch 还没有实现（计划在 M2 提供）')
        },
        ui: adapter.ui,
        addStyle: css => adapter.ui.addStyle(css),
        contents: adapter.contents,
      },
    })
    for (const plugin of officialPlugins) {
      try {
        await host.load(plugin, { enabled: isEnabled(state.plugins, plugin.meta.id) })
      } catch (e) {
        console.error(`[zhihu-browser] 加载插件 ${plugin.meta.id} 失败`, e)
      }
    }
    adapter.start(host)

    // 在设置页里启用 / 停用插件：立即生效，不用刷新页面
    watch(
      api,
      key => key === PLUGINS_KEY,
      (_key, value) => {
        const states = toPluginStates(value)
        for (const plugin of officialPlugins) {
          const id = plugin.meta.id
          const want = isEnabled(states, id)
          if (host.plugin(id)?.enabled === want) continue
          if (want) void host.enable(id)
          else host.disable(id)
        }
      },
    )
    watch(
      api,
      key => key === SAFE_MODE_KEY,
      (_key, value) => {
        if ((value === true) !== state.safeMode) adapter.ui.toast('安全模式在刷新页面后生效')
      },
    )
  },
})
