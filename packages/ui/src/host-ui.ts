// 把界面接到宿主上：键盘快捷键、命令面板和内置命令、插件出错时的提示。

import { formatShortcut, type Host, normalizeShortcut, type Platform, resolveMod } from '@zhihu-browser/core'
import type { Dispose } from '@zhihu-browser/sdk'
import { listenKeys } from './keyboard'
import type { PageUI } from './page-ui'
import { openPalette, type PaletteItem } from './palette'
import { openDiagnosePanel, openPluginPanel, openShortcutHelp, sourceName } from './panels'

/** 打开命令面板的默认快捷键：macOS 上是 ⌘K，其他系统是 Ctrl+K */
export const DEFAULT_PALETTE_KEYS = 'mod+k'

export interface HostUIOptions {
  doc: Document
  host: Host
  ui: PageUI
  platform: Platform
  /** 打开命令面板的快捷键，默认 mod+k；空字符串表示不用快捷键 */
  paletteKeys?: string
  /** 内置命令"打开设置页"；不提供时不显示这个命令 */
  openSettings?: () => void
  /** 内置命令"页面结构诊断"：生成诊断信息；不提供时不显示这个命令 */
  diagnose?: () => string
}

export interface HostUI {
  openPalette(): void
  setPaletteKeys(keys: string): void
  dispose(): void
}

export function connectHostUI(options: HostUIOptions): HostUI {
  const { doc, host, ui, platform } = options
  let paletteMatch = ''

  const builtins: PaletteItem[] = [
    {
      id: 'zb.shortcuts',
      title: '查看快捷键',
      keywords: ['快捷键', '帮助', 'shortcut', 'help'],
      run: () => openShortcutHelp(ui, doc, host, platform),
    },
    {
      id: 'zb.plugins',
      title: '插件状态与日志',
      keywords: ['插件', '日志', '报错', 'plugin', 'log'],
      run: () => openPluginPanel(ui, doc, host),
    },
  ]
  const openSettings = options.openSettings
  if (openSettings) {
    builtins.push({ id: 'zb.settings', title: '打开设置页', keywords: ['设置', '选项', 'settings'], run: openSettings })
  }
  const diagnose = options.diagnose
  if (diagnose) {
    builtins.push({
      id: 'zb.diagnose',
      title: '页面结构诊断',
      keywords: ['诊断', '排查', '问题', '结构', 'debug'],
      run: () => openDiagnosePanel(ui, doc, diagnose()),
    })
  }

  function items(): PaletteItem[] {
    // 命令的标题和同一个插件某个快捷键的说明相同时，在命令旁边显示这个快捷键
    const keys = new Map<string, string>()
    for (const s of host.shortcuts()) {
      if (s.keys && !s.conflictWith) keys.set(`${s.pluginId}\n${s.description}`, s.keys)
    }
    const commands = host.commands().map(c => {
      const shortcut = keys.get(`${c.pluginId}\n${c.title}`)
      return {
        id: c.id,
        title: c.title,
        source: sourceName(host, c.pluginId),
        keywords: c.keywords,
        ...(shortcut ? { shortcut: formatShortcut(shortcut, platform) } : {}),
        run: () => host.runCommand(c.id),
      }
    })
    return [...commands, ...builtins.map(b => ({ ...b, source: 'zhihu-browser' }))]
  }

  function showPalette(): void {
    openPalette(ui, doc, items(), {
      isToggle: stroke => {
        try {
          return !!paletteMatch && resolveMod(normalizeShortcut(stroke), platform) === paletteMatch
        } catch {
          return false
        }
      },
    })
  }

  // 面板开着的时候不处理快捷键；输入框里、我们自己的界面里的按键由 listenKeys 排除
  const offKeys = listenKeys(doc, stroke => !ui.hasModal() && host.handleKey(stroke) !== 'none')

  let offPalette: Dispose = () => {}
  function setPaletteKeys(keys: string): void {
    offPalette()
    offPalette = () => {}
    paletteMatch = ''
    if (!keys.trim()) return
    try {
      offPalette = host.registerHostShortcut(keys, showPalette, { description: '打开命令面板' })
      paletteMatch = resolveMod(normalizeShortcut(keys), platform)
    } catch (e) {
      console.warn('[zhihu-browser] 命令面板的快捷键写法不对，改用默认的', e)
      if (keys !== DEFAULT_PALETTE_KEYS) setPaletteKeys(DEFAULT_PALETTE_KEYS)
    }
  }
  setPaletteKeys(options.paletteKeys ?? DEFAULT_PALETTE_KEYS)

  const offState = host.on('pluginState', info => {
    if (info.state !== 'failed') return
    ui.toast(`插件"${info.meta.name}"出错，已在这个页面停用。可以在命令面板的"插件状态与日志"里查看原因。`, {
      tone: 'error',
      duration: 8000,
    })
  })

  return {
    openPalette: showPalette,
    setPaletteKeys,
    dispose() {
      offKeys()
      offPalette()
      offState()
    },
  }
}
