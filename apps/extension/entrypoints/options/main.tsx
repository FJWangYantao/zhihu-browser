// 设置页：官方插件的启用开关和设置（表单根据插件 meta.settings 自动生成）、快捷键、数据包、安全模式。
// 修改直接写进 chrome.storage，已打开的知乎页面会立即应用（安全模式需要刷新页面）。

import { checkSettingValue } from '@zhihu-browser/core'
import type { PluginMeta } from '@zhihu-browser/sdk'
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { browser } from 'wxt/browser'
import { detectPlatform } from '../../src/platform'
import { officialPlugins } from '../../src/plugins'
import { isEnabled, PLUGINS_KEY, SAFE_MODE_KEY, SETTINGS_PREFIX, type StorageApi, watch } from '../../src/storage'
import { Card, PluginCard, Switch } from './components'
import { exportPack, PackImport } from './packs'
import { ShortcutSettings } from './shortcuts'
import { loadOptionsState, type OptionsState, watchedKey } from './state'
import './style.css'

const api = browser.storage as unknown as StorageApi
const plugins: readonly { meta: PluginMeta }[] = officialPlugins
const platform = detectPlatform()
const pluginName = (id: string) => plugins.find(p => p.meta.id === id)?.meta.name ?? id

function App() {
  const [state, setState] = useState<OptionsState>()
  const [notice, setNotice] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const reload = () => void loadOptionsState(api, plugins).then(setState)
    reload()
    // 其他标签页、知乎页面上的"屏蔽作者"按钮等修改了设置
    return watch(api, watchedKey, reload)
  }, [])

  if (!state) return <p class="loading">正在读取设置…</p>

  const saved = (message = '已保存') => {
    setNotice(message)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNotice(''), 2000)
  }

  async function toggle(id: string, enabled: boolean) {
    if (!state) return
    await api.local.set({ [PLUGINS_KEY]: { ...state.plugins, [id]: { enabled } } })
    saved(enabled ? '已启用' : '已停用')
  }

  async function change(meta: PluginMeta, key: string, value: unknown) {
    if (!state) return
    const spec = meta.settings?.[key]
    const problem = spec && checkSettingValue(spec, value)
    if (!spec || problem) {
      saved(`没有保存：${problem ?? '未知的设置项'}`)
      return
    }
    await api.local.set({ [SETTINGS_PREFIX + meta.id]: { ...state.settings[meta.id], [key]: value } })
    saved()
  }

  async function reset(meta: PluginMeta) {
    await api.local.remove(SETTINGS_PREFIX + meta.id)
    saved('已恢复默认设置')
  }

  return (
    <main>
      <header class="page-header">
        <h1>zhihu-browser 设置</h1>
        <p>修改会立即应用到已经打开的知乎页面。在知乎页面上按 {platform === 'mac' ? '⌘K' : 'Ctrl+K'} 打开命令面板。</p>
      </header>

      {state.safeMode && <p class="banner">安全模式已打开：知乎页面上不会运行任何插件。</p>}

      {plugins.map(({ meta }) => (
        <PluginCard
          key={meta.id}
          meta={meta}
          enabled={isEnabled(state.plugins, meta.id)}
          values={state.settings[meta.id] ?? {}}
          onToggle={enabled => void toggle(meta.id, enabled)}
          onChange={(key, value) => void change(meta, key, value)}
          onReset={() => void reset(meta)}
          onExport={() => {
            exportPack(meta, state.settings[meta.id] ?? {})
            saved('已导出')
          }}
        />
      ))}

      <ShortcutSettings
        api={api}
        platform={platform}
        paletteKeys={state.paletteKeys}
        keymap={state.keymap}
        registry={state.registry}
        pluginName={pluginName}
        onSaved={saved}
      />

      <PackImport api={api} plugins={plugins} settings={state.settings} onSaved={saved} />

      <Card
        title="安全模式"
        description="打开后，知乎页面上不运行任何插件，用于排查问题。刷新知乎页面后生效。"
        aside={
          <Switch
            label="安全模式"
            checked={state.safeMode}
            onChange={on => void api.local.set({ [SAFE_MODE_KEY]: on }).then(() => saved())}
          />
        }
      />

      <footer class="page-footer">
        zhihu-browser 不收集任何数据，设置只保存在这台电脑的浏览器里。本项目与知乎官方无关。
      </footer>

      <div class={`notice${notice ? ' show' : ''}`} role="status">
        {notice}
      </div>
    </main>
  )
}

const root = document.getElementById('app')
if (root) render(<App />, root)
