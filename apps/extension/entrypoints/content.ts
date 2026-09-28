import '@zhihu-browser/adapter-zhihu/styles.css'
import '@zhihu-browser/adapter-zhihu/theme.css'
import { createAdapter, findSidebar, syncingStyles } from '@zhihu-browser/adapter-zhihu'
import { createHost } from '@zhihu-browser/core'
import { connectHostUI, createPageUI, DEFAULT_PALETTE_KEYS } from '@zhihu-browser/ui'
import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { detectPlatform } from '../src/platform'
import { officialPlugins } from '../src/plugins'
import {
  createSettingsBackend,
  createStorageBackend,
  isEnabled,
  KEYMAP_KEY,
  PALETTE_KEYS_KEY,
  PLUGINS_KEY,
  readState,
  SAFE_MODE_KEY,
  type StorageApi,
  saveRegistry,
  toKeymap,
  toPluginStates,
  watch,
} from '../src/storage'

// 扩展隔离环境（ISOLATED world）：插件宿主、知乎适配层、核心界面和官方插件从这里启动。
export default defineContentScript({
  matches: ['*://*.zhihu.com/*'],
  runAt: 'document_start',
  // 不向知乎页面 postMessage（WXT 旧的"内容脚本已启动"通知）
  noScriptStartedPostMessage: true,
  async main() {
    // 先创建适配层：打开预隐藏、开始观察页面，插件加载好之前出现的内容先排队
    const adapter = createAdapter()
    const ui = createPageUI(document, { sidebar: () => findSidebar(document) })
    const api = browser.storage as unknown as StorageApi
    const state = await readState(api)
    const platform = detectPlatform()
    const host = createHost({
      safeMode: state.safeMode,
      platform,
      keymap: state.keymap,
      services: {
        settings: createSettingsBackend(api),
        storage: createStorageBackend(api),
        fetch: async () => {
          throw new Error('z.fetch 还没有实现（计划在 M2 提供）')
        },
        ui,
        // 插件的样式有增减之后，适配层重新检查主题 token
        addStyle: syncingStyles(css => ui.addStyle(css), adapter.theme),
        contents: adapter.contents,
      },
    })
    const hostUI = connectHostUI({
      doc: document,
      host,
      ui,
      platform,
      paletteKeys: state.paletteKeys,
      // 内容脚本不能直接打开设置页，请后台打开
      openSettings: () => void browser.runtime.sendMessage({ type: 'open-options' }).catch(() => {}),
      diagnose: () => adapter.describe(browser.runtime.getManifest().version),
    })
    for (const plugin of officialPlugins) {
      try {
        await host.load(plugin, { enabled: isEnabled(state.plugins, plugin.meta.id) })
      } catch (e) {
        console.error(`[zhihu-browser] 加载插件 ${plugin.meta.id} 失败`, e)
      }
    }
    adapter.start(host)

    // 把登记的快捷键写给设置页（设置页据此列出可以改的快捷键）
    let registryTimer: ReturnType<typeof setTimeout> | undefined
    const publishRegistry = () => {
      clearTimeout(registryTimer)
      registryTimer = setTimeout(() => {
        void saveRegistry(api, { platform, shortcuts: host.shortcuts() }).catch(() => {})
      }, 500)
    }
    host.on('shortcutsChanged', publishRegistry)
    publishRegistry()

    // 在设置页里启用 / 停用插件、改键：立即生效，不用刷新页面
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
      key => key === KEYMAP_KEY,
      (_key, value) => host.setKeymap(toKeymap(value)),
    )
    watch(
      api,
      key => key === PALETTE_KEYS_KEY,
      (_key, value) => hostUI.setPaletteKeys(typeof value === 'string' ? value : DEFAULT_PALETTE_KEYS),
    )
    watch(
      api,
      key => key === SAFE_MODE_KEY,
      (_key, value) => {
        if ((value === true) !== state.safeMode) ui.toast('安全模式在刷新页面后生效')
      },
    )
  },
})
