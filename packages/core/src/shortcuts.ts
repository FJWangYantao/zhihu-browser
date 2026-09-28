import type { PageType } from '@zhihu-browser/sdk'
import type { Keymap, Platform, ShortcutInfo } from './types'

/** 宿主自己的快捷键（例如打开命令面板）用的"插件 id"。插件 id 不能以 @ 开头，不会重名。 */
export const HOST_OWNER = '@host'

const MODIFIER_ORDER = ['mod', 'ctrl', 'alt', 'shift', 'meta'] as const
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  mod: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
}
const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
}
const NAMED_KEYS = new Set([
  'enter',
  'escape',
  'space',
  'tab',
  'backspace',
  'delete',
  'up',
  'down',
  'left',
  'right',
  'pageup',
  'pagedown',
  'home',
  'end',
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
])

/**
 * 把快捷键写法规范化：小写、修饰键按固定顺序排列，按键序列之间用一个空格分隔。
 * 例如 'Shift+J' → 'shift+j'，'Mod+Enter' → 'mod+enter'，'g  g' → 'g g'。写法不对时抛出错误。
 */
export function normalizeShortcut(keys: string): string {
  const steps = keys.trim().toLowerCase().split(/\s+/)
  if (!steps[0]) throw new Error('快捷键不能为空')
  return steps.map(step => normalizeStep(step, keys)).join(' ')
}

/** 拆开一步按键；"+" 键本身写成 '+' 或 'shift++' */
function splitStep(step: string): string[] {
  if (step === '+') return ['+']
  if (step.endsWith('++')) return [...step.slice(0, -2).split('+'), '+']
  return step.split('+')
}

function normalizeStep(step: string, original: string): string {
  const parts = splitStep(step)
  const modifiers = new Set<string>()
  let key: string | undefined
  for (const [i, raw] of parts.entries()) {
    const isLast = i === parts.length - 1
    const modifier = MODIFIER_ALIASES[raw]
    if (modifier && !isLast) {
      modifiers.add(modifier)
      continue
    }
    if (!isLast) throw new Error(`快捷键 ${original} 里有不认识的修饰键 ${raw}`)
    const name = KEY_ALIASES[raw] ?? raw
    if (name.length !== 1 && !NAMED_KEYS.has(name)) throw new Error(`快捷键 ${original} 里有不认识的按键 ${raw}`)
    key = name
  }
  if (!key) throw new Error(`快捷键 ${original} 缺少按键`)
  const ordered = MODIFIER_ORDER.filter(m => modifiers.has(m))
  return [...ordered, key].join('+')
}

/** 把 mod 换成具体平台上的修饰键：macOS 上是 meta（⌘），其他系统是 ctrl。参数必须是规范化后的写法。 */
export function resolveMod(keys: string, platform: Platform): string {
  if (!keys.includes('mod')) return keys
  const target = platform === 'mac' ? 'meta' : 'ctrl'
  return keys
    .split(' ')
    .map(step => {
      const parts = splitStep(step)
      const key = parts.pop() ?? ''
      return normalizeStep([...parts.map(m => (m === 'mod' ? target : m)), key].join('+'), keys)
    })
    .join(' ')
}

const MAC_MODIFIERS: Record<string, string> = { mod: '⌘', meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' }
const OTHER_MODIFIERS: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' }
const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  enter: 'Enter',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
}

/** 显示给用户看的写法：macOS 上是 ⌘⇧K，其他系统是 Ctrl+Shift+K；按键序列用空格隔开，如 G G。 */
export function formatShortcut(keys: string, platform: Platform): string {
  return normalizeShortcut(keys)
    .split(' ')
    .map(step => {
      const parts = splitStep(step)
      const key = parts.pop() ?? ''
      const label = KEY_LABELS[key] ?? key.toUpperCase()
      const names = platform === 'mac' ? MAC_MODIFIERS : OTHER_MODIFIERS
      const modifiers = parts.map(m => names[m] ?? m)
      return platform === 'mac' ? [...modifiers, label].join('') : [...modifiers, label].join('+')
    })
    .join(' ')
}

export interface ShortcutEntry {
  /** 注册时的写法（规范化后）。用户改键时用它来标识这个快捷键 */
  defaultKeys: string
  /** 插件 id；宿主自己的快捷键是 HOST_OWNER */
  pluginId: string
  description: string
  when?: PageType[]
  run: () => void
}

const overlaps = (a?: PageType[], b?: PageType[]) => !a || !b || a.some(t => b.includes(t))
const applies = (entry: ShortcutEntry, page?: PageType) =>
  !entry.when || (page !== undefined && entry.when.includes(page))

/** 用户改键时用的标识，如 'reader:r' */
export const shortcutId = (entry: { pluginId: string; defaultKeys: string }) => `${entry.pluginId}:${entry.defaultKeys}`

/**
 * 快捷键登记表。
 * - 宿主自己的快捷键优先；插件之间绑定同一个快捷键、且适用页面有重叠时，先注册的生效。
 * - 用户可以改键（keymap），改成空字符串表示停用。
 * - 比较时按平台解析 mod：在 Windows 上 'mod+k' 和 'ctrl+k' 是同一个快捷键。
 */
export class ShortcutRegistry {
  private entries: ShortcutEntry[] = []
  private keymap: Keymap = {}

  constructor(private readonly platform: Platform = 'other') {}

  add(entry: ShortcutEntry): () => void {
    this.entries.push(entry)
    return () => {
      this.entries = this.entries.filter(e => e !== entry)
    }
  }

  setKeymap(keymap: Keymap): void {
    this.keymap = { ...keymap }
  }

  /** 生效的写法（改键之后）；停用时是空字符串。改键的写法不对时沿用默认的 */
  private keysOf(entry: ShortcutEntry): string {
    const override = this.keymap[shortcutId(entry)]
    if (override === undefined) return entry.defaultKeys
    if (!override.trim()) return ''
    try {
      return normalizeShortcut(override)
    } catch {
      return entry.defaultKeys
    }
  }

  /** 宿主的在前，其余按注册顺序；带上按平台解析后用来比较的写法 */
  private active(): { entry: ShortcutEntry; keys: string; match: string }[] {
    const ordered = [
      ...this.entries.filter(e => e.pluginId === HOST_OWNER),
      ...this.entries.filter(e => e.pluginId !== HOST_OWNER),
    ]
    return ordered.map(entry => {
      const keys = this.keysOf(entry)
      return { entry, keys, match: keys && resolveMod(keys, this.platform) }
    })
  }

  /** 在指定页面上按下这个快捷键（可以是按键序列，必须是规范化后的写法）时应当执行的条目 */
  resolve(keys: string, page?: PageType): ShortcutEntry | undefined {
    const match = resolveMod(keys, this.platform)
    return this.active().find(a => a.match && a.match === match && applies(a.entry, page))?.entry
  }

  /** 有没有以这些按键开头的更长的按键序列 */
  hasPrefix(keys: string, page?: PageType): boolean {
    const prefix = `${resolveMod(keys, this.platform)} `
    return this.active().some(a => a.match.startsWith(prefix) && applies(a.entry, page))
  }

  list(): ShortcutInfo[] {
    const active = this.active()
    return active.map(({ entry, keys, match }, i) => {
      const earlier = match
        ? active
            .slice(0, i)
            .find(a => a.match === match && a.entry.pluginId !== entry.pluginId && overlaps(a.entry.when, entry.when))
        : undefined
      return {
        id: shortcutId(entry),
        keys,
        defaultKeys: entry.defaultKeys,
        pluginId: entry.pluginId,
        description: entry.description,
        ...(entry.when ? { when: [...entry.when] } : {}),
        ...(earlier ? { conflictWith: earlier.entry.pluginId } : {}),
        ...(keys ? {} : { disabled: true }),
      }
    })
  }
}
