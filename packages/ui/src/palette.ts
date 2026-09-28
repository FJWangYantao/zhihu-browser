// 命令面板：搜索并执行插件注册的命令和内置命令。

import { strokeOf } from './keyboard'
import type { Modal, PageUI } from './page-ui'
import { h } from './util'

export interface PaletteItem {
  id: string
  title: string
  /** 来源：插件名称 */
  source?: string
  keywords?: readonly string[]
  /** 显示在右侧的快捷键 */
  shortcut?: string
  run(): unknown
}

export interface PaletteOptions {
  placeholder?: string
  /** 这个按键再按一次时关闭面板（打开面板的快捷键） */
  isToggle?: (stroke: string) => boolean
}

/** 按输入过滤并排序：每个词都要出现在标题、来源或关键词里；标题以输入开头的排最前，其次是标题里包含输入的 */
export function filterItems<T extends PaletteItem>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  const terms = q.split(/\s+/)
  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const title = item.title.toLowerCase()
    const text = [title, item.source ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase()
    if (!terms.every(term => text.includes(term))) return
    scored.push({ item, index, score: title.startsWith(q) ? 3 : title.includes(q) ? 2 : 1 })
  })
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(s => s.item)
}

function runItem(item: PaletteItem): void {
  try {
    const result = item.run() as { then?: unknown } | undefined
    if (result && typeof result.then === 'function') {
      ;(result as Promise<unknown>).then(undefined, e => console.error('[zhihu-browser] 命令出错', e))
    }
  } catch (e) {
    console.error('[zhihu-browser] 命令出错', e)
  }
}

/** 打开命令面板。选中的命令在面板关闭之后执行 */
export function openPalette(
  ui: PageUI,
  doc: Document,
  items: readonly PaletteItem[],
  options: PaletteOptions = {},
): Modal {
  const modal = ui.openModal({ label: '命令面板', className: 'palette', position: 'top' })
  const { panel, close } = modal
  const input = h(doc, 'input', {
    type: 'text',
    role: 'combobox',
    'aria-label': '搜索命令',
    'aria-expanded': 'true',
    'aria-controls': 'zb-palette-list',
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: options.placeholder ?? '输入命令名称…',
  })
  const list = h(doc, 'div', { id: 'zb-palette-list', role: 'listbox', 'aria-label': '命令' })
  panel.append(input, list)

  let shown: PaletteItem[] = []
  let selected = 0

  const options_ = () => [...list.querySelectorAll<HTMLElement>('[role="option"]')]

  function select(index: number): void {
    if (!shown.length || index === selected) return
    selected = index
    options_().forEach((el, i) => {
      el.setAttribute('aria-selected', String(i === selected))
    })
    input.setAttribute('aria-activedescendant', `zb-palette-${selected}`)
    options_()[selected]?.scrollIntoView?.({ block: 'nearest' })
  }

  function run(item: PaletteItem): void {
    close()
    runItem(item)
  }

  function render(): void {
    shown = filterItems(items, input.value)
    selected = 0
    list.replaceChildren(
      ...shown.map((item, i) => {
        const option = h(
          doc,
          'div',
          { id: `zb-palette-${i}`, role: 'option', 'aria-selected': String(i === selected) },
          h(doc, 'span', { class: 'title' }, item.title),
          item.source ? h(doc, 'span', { class: 'source' }, item.source) : null,
          item.shortcut ? h(doc, 'kbd', {}, item.shortcut) : null,
        )
        option.addEventListener('mousemove', () => select(i))
        option.addEventListener('click', () => run(item))
        return option
      }),
    )
    if (!shown.length) list.append(h(doc, 'div', { class: 'empty' }, '没有匹配的命令'))
    if (shown.length) input.setAttribute('aria-activedescendant', 'zb-palette-0')
    else input.removeAttribute('aria-activedescendant')
  }

  input.addEventListener('input', render)
  input.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      if (shown.length) select((selected + step + shown.length) % shown.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = shown[selected]
      if (item) run(item)
    } else {
      const stroke = strokeOf(event)
      if (stroke && options.isToggle?.(stroke)) {
        event.preventDefault()
        close()
      }
    }
  })

  render()
  input.focus()
  return modal
}
