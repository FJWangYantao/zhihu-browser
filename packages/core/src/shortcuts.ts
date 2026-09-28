import type { PageType } from '@zhihu-browser/sdk'
import type { ShortcutInfo } from './types'

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

function normalizeStep(step: string, original: string): string {
  const parts = step.split('+')
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

export interface ShortcutEntry {
  keys: string
  pluginId: string
  description: string
  when?: PageType[]
  run: () => void
}

const overlaps = (a?: PageType[], b?: PageType[]) => !a || !b || a.some(t => b.includes(t))
const applies = (entry: ShortcutEntry, page?: PageType) =>
  !entry.when || (page !== undefined && entry.when.includes(page))

/** 快捷键登记表。多个插件绑定同一个快捷键、且适用页面有重叠时，先注册的生效。 */
export class ShortcutRegistry {
  private entries: ShortcutEntry[] = []

  add(entry: ShortcutEntry): () => void {
    this.entries.push(entry)
    return () => {
      this.entries = this.entries.filter(e => e !== entry)
    }
  }

  /** 在指定页面上按下这个快捷键时应当执行的条目 */
  resolve(keys: string, page?: PageType): ShortcutEntry | undefined {
    return this.entries.find(e => e.keys === keys && applies(e, page))
  }

  list(): ShortcutInfo[] {
    return this.entries.map((entry, i) => {
      const earlier = this.entries
        .slice(0, i)
        .find(e => e.keys === entry.keys && e.pluginId !== entry.pluginId && overlaps(e.when, entry.when))
      return {
        keys: entry.keys,
        pluginId: entry.pluginId,
        description: entry.description,
        ...(entry.when ? { when: entry.when } : {}),
        ...(earlier ? { conflictWith: earlier.pluginId } : {}),
      }
    })
  }
}
