// 设置页的"快捷键"：打开命令面板的快捷键，以及插件注册的快捷键（可以改键、停用）。

import { formatShortcut, HOST_OWNER, type Keymap, normalizeShortcut, type Platform } from '@zhihu-browser/core'
import { useState } from 'preact/hooks'
import { KEYMAP_KEY, PALETTE_KEYS_KEY, type Registry, type StorageApi } from '../../src/storage'
import { Card } from './components'

/** 打开命令面板的默认快捷键（和 @zhihu-browser/ui 里的一致） */
export const DEFAULT_PALETTE_KEYS = 'mod+k'

/** 解析用户输入的快捷键；空白表示停用 */
export function parseKeys(text: string): { keys: string } | { error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { keys: '' }
  try {
    return { keys: normalizeShortcut(trimmed) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function display(keys: string, platform: Platform): string {
  if (!keys) return '已停用'
  try {
    return formatShortcut(keys, platform)
  } catch {
    return keys
  }
}

function KeysInput(props: {
  id: string
  label: string
  value: string
  defaultKeys: string
  platform: Platform
  warning?: string
  onSave: (keys: string) => Promise<void>
}) {
  const [error, setError] = useState('')
  return (
    <div class="field shortcut">
      <label for={props.id}>{props.label}</label>
      <div class="shortcut-input">
        <input
          id={props.id}
          type="text"
          value={props.value}
          placeholder="已停用"
          spellcheck={false}
          aria-invalid={error ? 'true' : undefined}
          onChange={e => {
            const parsed = parseKeys(e.currentTarget.value)
            if ('error' in parsed) {
              setError(parsed.error)
              return
            }
            setError('')
            void props.onSave(parsed.keys)
          }}
        />
        <kbd>{display(props.value, props.platform)}</kbd>
        {props.value !== props.defaultKeys && (
          <button
            type="button"
            class="link"
            onClick={() => {
              setError('')
              void props.onSave(props.defaultKeys)
            }}
          >
            恢复默认
          </button>
        )}
      </div>
      {error && <p class="description error">{error}</p>}
      {props.warning && <p class="description error">{props.warning}</p>}
    </div>
  )
}

export function ShortcutSettings(props: {
  api: StorageApi
  platform: Platform
  paletteKeys?: string
  keymap: Keymap
  registry?: Registry
  pluginName: (id: string) => string
  onSaved: (message?: string) => void
}) {
  const { api, platform, keymap, registry } = props
  const shortcuts = (registry?.shortcuts ?? []).filter(s => s.pluginId !== HOST_OWNER)
  const groups = new Map<string, typeof shortcuts>()
  for (const s of shortcuts) groups.set(s.pluginId, [...(groups.get(s.pluginId) ?? []), s])

  async function savePalette(keys: string) {
    await api.local.set({ [PALETTE_KEYS_KEY]: keys })
    props.onSaved(keys ? '已保存' : '已取消命令面板的快捷键')
  }

  async function saveKeymap(id: string, defaultKeys: string, keys: string) {
    const next = { ...keymap }
    if (keys === defaultKeys) delete next[id]
    else next[id] = keys
    await api.local.set({ [KEYMAP_KEY]: next })
    props.onSaved(keys ? '已保存' : '已停用这个快捷键')
  }

  const conflictText = (pluginId: string) =>
    `和"${pluginId === HOST_OWNER ? '命令面板' : props.pluginName(pluginId)}"的快捷键冲突，没有生效`

  return (
    <Card
      title="快捷键"
      description="在知乎页面上生效，焦点在输入框里时不起作用。写法如 ctrl+k、shift+j、g g（依次按下两个键）；mod 在 macOS 上是 ⌘，在其他系统上是 Ctrl。清空表示停用。"
    >
      <div class="fields">
        <KeysInput
          id="palette-keys"
          label="打开命令面板"
          value={props.paletteKeys ?? DEFAULT_PALETTE_KEYS}
          defaultKeys={DEFAULT_PALETTE_KEYS}
          platform={platform}
          onSave={savePalette}
        />
        {[...groups].map(([pluginId, items]) => (
          <div key={pluginId} class="shortcut-group">
            <h3>{props.pluginName(pluginId)}</h3>
            {items.map(s => (
              <KeysInput
                key={s.id}
                id={`shortcut-${s.id}`}
                label={s.description}
                value={keymap[s.id] ?? s.defaultKeys}
                defaultKeys={s.defaultKeys}
                platform={platform}
                warning={s.conflictWith ? conflictText(s.conflictWith) : undefined}
                onSave={keys => saveKeymap(s.id, s.defaultKeys, keys)}
              />
            ))}
          </div>
        ))}
        {!registry && <p class="description">打开一次知乎页面后，这里会列出插件注册的快捷键。</p>}
        {registry && !shortcuts.length && <p class="description">已启用的插件没有注册快捷键。</p>}
      </div>
    </Card>
  )
}
