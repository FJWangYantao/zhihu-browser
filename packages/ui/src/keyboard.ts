// 键盘：把按键事件转成快捷键写法，交给宿主处理。焦点在输入区域或我们自己的界面里时不处理。

import type { Dispose } from '@zhihu-browser/sdk'

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'Fn',
  'FnLock',
  'OS',
  'Hyper',
])
const NAMED_KEYS: Record<string, string> = {
  ' ': 'space',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}
/** 不会输入文字的 input 类型：焦点在它们上面时快捷键照常生效 */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/**
 * 把按键事件转成一步快捷键写法（修饰键在前），如 'ctrl+k'、'shift+j'、'g'、'?'。
 * 只按了修饰键、正在用输入法输入时返回 undefined。
 * 符号键的 Shift 已经体现在字符里（在美式键盘上 ? 是 Shift+/），所以符号键不再加 shift。
 */
export function strokeOf(event: KeyboardEvent): string | undefined {
  if (event.isComposing || event.keyCode === 229) return undefined
  const raw = event.key
  if (!raw || MODIFIER_KEYS.has(raw)) return undefined
  let key = NAMED_KEYS[raw] ?? raw.toLowerCase()
  // macOS 上按住 Option 时 key 是特殊字符（Option+K 是 ˚），这时按物理键位取字母和数字
  if ((event.altKey || raw === 'Dead' || raw === 'Unidentified') && /^(?:Key[A-Z]|Digit\d)$/.test(event.code)) {
    key = event.code.slice(-1).toLowerCase()
  }
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('ctrl')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey && (/^[a-z0-9]$/.test(key) || key.length > 1)) modifiers.push('shift')
  if (event.metaKey) modifiers.push('meta')
  return [...modifiers, key].join('+')
}

/** 事件发生在可以输入文字的地方：输入框、文本框、下拉框或可编辑区域 */
export function isEditableEvent(event: Event): boolean {
  const target = event.composedPath()[0] ?? event.target
  if (!target || (target as Node).nodeType !== 1) return false
  const el = target as HTMLElement
  if (el.isContentEditable || el.closest('[contenteditable]:not([contenteditable="false"])')) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type)
  return false
}

/** 事件来自我们自己的界面（界面元素都带 data-zb-ui 属性） */
export function isOwnUIEvent(event: Event): boolean {
  return event
    .composedPath()
    .some(node => (node as Element).nodeType === 1 && (node as Element).hasAttribute?.('data-zb-ui'))
}

/**
 * 在文档上监听按键（捕获阶段，早于页面自己的处理）。
 * handle 返回 true 表示这个按键被用掉了：阻止默认行为，不再往下传。
 */
export function listenKeys(doc: Document, handle: (stroke: string, event: KeyboardEvent) => boolean): Dispose {
  const listener = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isEditableEvent(event) || isOwnUIEvent(event)) return
    const stroke = strokeOf(event)
    if (!stroke || !handle(stroke, event)) return
    event.preventDefault()
    event.stopPropagation()
  }
  doc.addEventListener('keydown', listener, true)
  return () => doc.removeEventListener('keydown', listener, true)
}
