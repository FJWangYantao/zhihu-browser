// 设置页：官方插件的启用开关和设置（表单根据插件 meta.settings 自动生成）、安全模式。
// 修改直接写进 chrome.storage，已打开的知乎页面会立即应用（安全模式需要刷新页面）。

import { checkSettingValue, sanitizeSettings } from '@zhihu-browser/core'
import type { PluginMeta, SettingSpec } from '@zhihu-browser/sdk'
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { browser } from 'wxt/browser'
import { officialPlugins } from '../../src/plugins'
import {
  isEnabled,
  PLUGINS_KEY,
  type PluginStates,
  readState,
  SAFE_MODE_KEY,
  SETTINGS_PREFIX,
  type StorageApi,
  watch,
} from '../../src/storage'
import './style.css'

const api = browser.storage as unknown as StorageApi
const plugins: readonly { meta: PluginMeta }[] = officialPlugins

interface State {
  safeMode: boolean
  plugins: PluginStates
  /** 各插件的设置，已经补上默认值 */
  settings: Record<string, Record<string, unknown>>
}

async function loadState(): Promise<State> {
  const base = await readState(api)
  const keys = plugins.map(p => SETTINGS_PREFIX + p.meta.id)
  const stored = await api.local.get(keys)
  const settings: State['settings'] = {}
  for (const { meta } of plugins) {
    const value = stored[SETTINGS_PREFIX + meta.id]
    const values = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
    settings[meta.id] = sanitizeSettings(meta, values).values
  }
  return { ...base, settings }
}

function App() {
  const [state, setState] = useState<State>()
  const [notice, setNotice] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const reload = () => void loadState().then(setState)
    reload()
    // 其他标签页、知乎页面上的"屏蔽作者"按钮等修改了设置
    return watch(api, key => key === SAFE_MODE_KEY || key === PLUGINS_KEY || key.startsWith(SETTINGS_PREFIX), reload)
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
        <p>修改会立即应用到已经打开的知乎页面。</p>
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
        />
      ))}

      <section class="card">
        <div class="card-header">
          <div>
            <h2>安全模式</h2>
            <p>打开后，知乎页面上不运行任何插件，用于排查问题。刷新知乎页面后生效。</p>
          </div>
          <Switch
            label="安全模式"
            checked={state.safeMode}
            onChange={on => void api.local.set({ [SAFE_MODE_KEY]: on }).then(() => saved())}
          />
        </div>
      </section>

      <footer class="page-footer">
        zhihu-browser 不收集任何数据，设置只保存在这台电脑的浏览器里。本项目与知乎官方无关。
      </footer>

      <div class={`notice${notice ? ' show' : ''}`} role="status">
        {notice}
      </div>
    </main>
  )
}

function Switch(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label class="switch" title={props.label}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        checked={props.checked}
        onChange={e => props.onChange(e.currentTarget.checked)}
      />
      <span aria-hidden="true" />
    </label>
  )
}

function PluginCard(props: {
  meta: PluginMeta
  enabled: boolean
  values: Record<string, unknown>
  onToggle: (enabled: boolean) => void
  onChange: (key: string, value: unknown) => void
  onReset: () => void
}) {
  const { meta } = props
  const specs = Object.entries(meta.settings ?? {})
  return (
    <section class={`card${props.enabled ? '' : ' disabled'}`}>
      <div class="card-header">
        <div>
          <h2>
            {meta.name} <span class="version">{meta.version}</span>
          </h2>
          {meta.description && <p>{meta.description}</p>}
        </div>
        <Switch label={`启用${meta.name}`} checked={props.enabled} onChange={props.onToggle} />
      </div>
      {specs.length > 0 && (
        <div class="fields">
          {specs.map(([key, spec]) => (
            <Field
              key={key}
              id={`${meta.id}-${key}`}
              spec={spec}
              value={props.values[key]}
              onChange={value => props.onChange(key, value)}
            />
          ))}
          <div class="actions">
            <button type="button" class="link" onClick={props.onReset}>
              恢复默认设置
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** 列表：每行一项，空行忽略 */
const toList = (text: string) =>
  text
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

function Field(props: { id: string; spec: SettingSpec; value: unknown; onChange: (value: unknown) => void }) {
  const { id, spec, value, onChange } = props
  const description = spec.description && <p class="description">{spec.description}</p>

  if (spec.type === 'boolean') {
    return (
      <div class="field checkbox">
        <input id={id} type="checkbox" checked={value === true} onChange={e => onChange(e.currentTarget.checked)} />
        <label for={id}>{spec.label}</label>
        {description}
      </div>
    )
  }

  let control: preact.JSX.Element
  switch (spec.type) {
    case 'number':
      control = (
        <input
          id={id}
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={String(value)}
          onChange={e => onChange(Number(e.currentTarget.value))}
        />
      )
      break
    case 'string':
      control = (
        <input
          id={id}
          type="text"
          placeholder={spec.placeholder}
          value={String(value ?? '')}
          onChange={e => onChange(e.currentTarget.value)}
        />
      )
      break
    case 'text':
      control = (
        <textarea id={id} rows={4} value={String(value ?? '')} onChange={e => onChange(e.currentTarget.value)} />
      )
      break
    case 'select':
      control = (
        <select id={id} value={String(value)} onChange={e => onChange(e.currentTarget.value)}>
          {Object.entries(spec.options).map(([optionValue, label]) => (
            <option key={optionValue} value={optionValue}>
              {label}
            </option>
          ))}
        </select>
      )
      break
    case 'list':
      control = (
        <textarea
          id={id}
          rows={Math.min(Math.max(Array.isArray(value) ? value.length + 1 : 3, 3), 12)}
          placeholder={`${spec.placeholder ?? ''}（每行一个）`}
          value={Array.isArray(value) ? value.join('\n') : ''}
          onChange={e => onChange(toList(e.currentTarget.value))}
        />
      )
      break
    case 'color':
      control = <input id={id} type="color" value={String(value)} onChange={e => onChange(e.currentTarget.value)} />
      break
  }
  return (
    <div class="field">
      <label for={id}>{spec.label}</label>
      {control}
      {description}
    </div>
  )
}

const root = document.getElementById('app')
if (root) render(<App />, root)
