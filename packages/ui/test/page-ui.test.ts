import { afterEach, describe, expect, test, vi } from 'vitest'
import { createPageUI, type PageUI } from '../src/index'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

let ui: PageUI | undefined
afterEach(() => {
  ui?.dispose()
  ui = undefined
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-theme')
})

const shadow = () => document.getElementById('zb-root')?.shadowRoot
const pressEscape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

describe('提示和确认框', () => {
  test('提示', () => {
    ui = createPageUI(document)
    ui.toast('你好', { tone: 'success' })
    const toast = shadow()?.querySelector('.toast')
    expect(toast?.textContent).toBe('你好')
    expect(toast?.getAttribute('data-tone')).toBe('success')
  })

  test('确认框：点确定、按 Esc、点背景', async () => {
    ui = createPageUI(document)
    const answer = ui.confirm('确定吗？', { okText: '好' })
    await flush()
    const ok = shadow()?.querySelector<HTMLButtonElement>('.dialog button.primary')
    expect(ok?.textContent).toBe('好')
    expect(shadow()?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('确定吗？')
    ok?.click()
    expect(await answer).toBe(true)
    expect(shadow()?.querySelector('.dialog')).toBeNull()

    const escaped = ui.confirm('再确认一次')
    await flush()
    pressEscape()
    expect(await escaped).toBe(false)

    const clicked = ui.confirm('第三次')
    await flush()
    shadow()?.querySelector<HTMLElement>('.backdrop')?.click()
    expect(await clicked).toBe(false)
  })

  test('同一时间只显示一个确认框，后来的排队', async () => {
    ui = createPageUI(document)
    const first = ui.confirm('一')
    const second = ui.confirm('二')
    await flush()
    expect([...(shadow()?.querySelectorAll('.message') ?? [])].map(m => m.textContent)).toEqual(['一'])
    shadow()?.querySelector<HTMLButtonElement>('button.primary')?.click()
    expect(await first).toBe(true)
    await flush()
    expect(shadow()?.querySelector('.message')?.textContent).toBe('二')
    pressEscape()
    expect(await second).toBe(false)
  })
})

describe('模态面板', () => {
  test('同一时间只有一个；关闭时通知、焦点回到原来的位置', () => {
    ui = createPageUI(document)
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    const closed: string[] = []
    const first = ui.openModal({ label: '一', onClose: () => closed.push('一') })
    expect(ui.hasModal()).toBe(true)
    ui.openModal({ label: '二', className: 'sheet', position: 'top', onClose: () => closed.push('二') })
    expect(closed).toEqual(['一'])
    expect(shadow()?.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(shadow()?.querySelector('.backdrop.top > .panel.sheet')).not.toBeNull()
    first.close()
    expect(closed).toEqual(['一'])
    pressEscape()
    expect(closed).toEqual(['一', '二'])
    expect(ui.hasModal()).toBe(false)
    expect(document.activeElement).toBe(button)
  })

  test('面板里的按键不会传到页面上', () => {
    ui = createPageUI(document)
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    const { panel } = ui.openModal({ label: '面板' })
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, composed: true }))
    expect(seen).not.toHaveBeenCalled()
    document.removeEventListener('keydown', seen)
  })
})

describe('挂载点', () => {
  test('工具栏、覆盖层、右侧栏', () => {
    const sidebar = document.createElement('aside')
    document.body.append(sidebar)
    ui = createPageUI(document, { sidebar: () => sidebar })
    const disposeRender = vi.fn()
    const unmount = ui.mount('toolbar', el => {
      el.textContent = '工具'
      return disposeRender
    })
    expect(shadow()?.querySelector('.toolbar .zb-slot')?.shadowRoot?.textContent).toBe('工具')
    unmount()
    expect(disposeRender).toHaveBeenCalledTimes(1)
    expect(shadow()?.querySelector('.toolbar .zb-slot')).toBeNull()

    const unmountOverlay = ui.mount('overlay', () => {})
    expect(document.documentElement.style.overflow).toBe('hidden')
    unmountOverlay()
    expect(document.documentElement.style.overflow).toBe('')

    ui.mount('sidebar', el => {
      el.textContent = '侧栏'
    })
    expect(sidebar.firstElementChild?.shadowRoot?.textContent).toBe('侧栏')
  })

  test('没有右侧栏时放进工具栏；渲染出错不影响页面', () => {
    ui = createPageUI(document, { sidebar: () => null })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmount = ui.mount('sidebar', () => {
      throw new Error('坏了')
    })
    expect(shadow()?.querySelector('.toolbar .zb-slot-sidebar')).not.toBeNull()
    expect(error).toHaveBeenCalled()
    unmount()
    error.mockRestore()
  })
})

test('全局样式', () => {
  ui = createPageUI(document)
  const before = document.adoptedStyleSheets.length
  const removeStyle = ui.addStyle('body { color: red }')
  expect(document.adoptedStyleSheets.length).toBe(before + 1)
  removeStyle()
  expect(document.adoptedStyleSheets.length).toBe(before)
})

test('跟随知乎的暗色', async () => {
  ui = createPageUI(document)
  ui.toast('x')
  const host = document.getElementById('zb-root')
  expect(host?.classList.contains('dark')).toBe(false)
  document.documentElement.setAttribute('data-theme', 'dark')
  await flush()
  expect(host?.classList.contains('dark')).toBe(true)
})

test('销毁后界面全部移除', async () => {
  ui = createPageUI(document)
  ui.toast('x')
  ui.openModal({ label: '面板' })
  ui.mount('overlay', () => {})
  ui.dispose()
  expect(document.getElementById('zb-root')).toBeNull()
  expect(document.documentElement.style.overflow).toBe('')
  ui = undefined
})
