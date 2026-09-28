// 页面上的界面层：提示、确认框、全局挂载点（toolbar / sidebar / overlay）、模态面板，以及全局样式。
// 界面放在 Shadow DOM 里，页面的样式影响不到，也不会漏到页面上。和知乎无关，知乎相关的位置（右侧栏）由调用方提供。

import type { Dispose, GlobalSlot, GlobalUI, Render } from '@zhihu-browser/sdk'
import { ROOT_CSS } from './styles'
import { h, once } from './util'

export interface PageUIOptions {
  /** 页面的右侧栏：sidebar 挂载点放在它的顶部；找不到时放进右下角的工具栏 */
  sidebar?: () => Element | null | undefined
}

export interface ModalOptions {
  /** 读屏软件读出的名称 */
  label: string
  className?: string
  /** 放在屏幕上方（命令面板）还是中间，默认中间 */
  position?: 'top' | 'center'
  /** 关闭时调用：按 Esc、点背景、打开了别的面板或者调用 close() */
  onClose?: () => void
}

export interface Modal {
  /** 面板元素，往里面放内容 */
  panel: HTMLElement
  close(): void
}

export interface PageUI extends GlobalUI {
  addStyle(css: string): Dispose
  /** 打开模态面板。同一时间只有一个，打开新的会先关掉旧的 */
  openModal(options: ModalOptions): Modal
  hasModal(): boolean
  /** 界面层的宿主元素，用来判断事件是不是来自我们自己的界面；还没创建时是 undefined */
  readonly host: HTMLElement | undefined
  dispose(): void
}

interface Root {
  host: HTMLElement
  shadow: ShadowRoot
  toolbar: HTMLElement
  toasts: HTMLElement
}

function adopt(doc: Document, target: Document | ShadowRoot, css: string): Dispose | undefined {
  const Sheet = doc.defaultView?.CSSStyleSheet
  if (!Sheet || !('adoptedStyleSheets' in target) || !('replaceSync' in Sheet.prototype)) return undefined
  try {
    const sheet = new Sheet()
    sheet.replaceSync(css)
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet]
    return once(() => {
      target.adoptedStyleSheets = target.adoptedStyleSheets.filter(s => s !== sheet)
    })
  } catch {
    return undefined
  }
}

/** 注入样式：优先用 adoptedStyleSheets（不受页面 CSP 的 style-src 限制），不支持时退回 <style>。 */
export function injectStyle(doc: Document, target: Document | ShadowRoot, css: string): Dispose {
  const adopted = adopt(doc, target, css)
  if (adopted) return adopted
  const style = doc.createElement('style')
  style.setAttribute('data-zb-ui', '')
  style.textContent = css
  if (target.nodeType === 9) {
    const d = target as Document
    ;(d.head ?? d.documentElement).append(style)
  } else target.append(style)
  return once(() => style.remove())
}

export function createPageUI(doc: Document, options: PageUIOptions = {}): PageUI {
  let root: Root | undefined
  let themeObserver: MutationObserver | undefined
  let modal: { backdrop: HTMLElement; close: () => void } | undefined
  let overlays = 0
  let savedOverflow = ''
  let dialogChain: Promise<unknown> = Promise.resolve()
  const disposers = new Set<Dispose>()

  /** 跟随知乎的暗色 */
  function syncTheme(host: HTMLElement): void {
    host.classList.toggle('dark', doc.documentElement.getAttribute('data-theme') === 'dark')
  }

  function ensureRoot(): Root {
    if (root?.host.isConnected) return root
    const host = h(doc, 'div', { id: 'zb-root', 'data-zb-ui': '' })
    const shadow = host.attachShadow({ mode: 'open' })
    injectStyle(doc, shadow, ROOT_CSS)
    const toolbar = h(doc, 'div', { class: 'toolbar' })
    const toasts = h(doc, 'div', { class: 'toasts' })
    shadow.append(toolbar, toasts)
    ;(doc.body ?? doc.documentElement).append(host)
    syncTheme(host)
    themeObserver?.disconnect()
    const View = doc.defaultView?.MutationObserver
    if (View) {
      themeObserver = new View(() => syncTheme(host))
      themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    }
    root = { host, shadow, toolbar, toasts }
    return root
  }

  /** 每个挂载点一个独立的 Shadow DOM，插件之间的样式互不影响 */
  function slotHost(className: string) {
    const host = h(doc, 'div', { class: className, 'data-zb-ui': '' })
    const container = doc.createElement('div')
    host.attachShadow({ mode: 'open' }).append(container)
    return { host, container }
  }

  function lockScroll(lock: boolean): void {
    const html = doc.documentElement
    if (lock) {
      if (overlays++ === 0) {
        savedOverflow = html.style.overflow
        html.style.overflow = 'hidden'
      }
    } else if (--overlays === 0) html.style.overflow = savedOverflow
  }

  function openModal(opts: ModalOptions): Modal {
    modal?.close()
    const { shadow } = ensureRoot()
    const backdrop = h(doc, 'div', { class: opts.position === 'top' ? 'backdrop top' : 'backdrop' })
    const panel = h(doc, 'div', {
      class: ['panel', opts.className].filter(Boolean).join(' '),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': opts.label,
      tabindex: '-1',
    })
    backdrop.append(panel)
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : undefined
    // 面板里的按键不传到页面上（知乎自己的快捷键等）；Esc 在任何地方都能关闭
    backdrop.addEventListener('keydown', event => event.stopPropagation())
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    doc.addEventListener('keydown', onEscape, true)
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) close()
    })
    const close = once(() => {
      doc.removeEventListener('keydown', onEscape, true)
      backdrop.remove()
      if (modal?.backdrop === backdrop) modal = undefined
      disposers.delete(close)
      opts.onClose?.()
      if (previous?.isConnected && !modal) previous.focus()
    })
    shadow.append(backdrop)
    modal = { backdrop, close }
    disposers.add(close)
    panel.focus()
    return { panel, close }
  }

  const ui: PageUI = {
    get host() {
      return root?.host
    },

    toast(message, opts = {}) {
      const { toasts } = ensureRoot()
      const el = h(doc, 'div', { class: 'toast', role: 'status', 'data-tone': opts.tone ?? 'info' }, message)
      toasts.append(el)
      const duration = Math.min(Math.max(opts.duration ?? 3000, 1000), 30_000)
      const timer = setTimeout(() => el.remove(), duration)
      disposers.add(() => clearTimeout(timer))
    },

    confirm(message, opts = {}) {
      // 同一时间只显示一个确认框，后来的排队
      const result = dialogChain.then(
        () =>
          new Promise<boolean>(resolve => {
            let answer = false
            const cancel = h(doc, 'button', { type: 'button' }, opts.cancelText ?? '取消')
            const ok = h(doc, 'button', { type: 'button', class: 'primary' }, opts.okText ?? '确定')
            const { panel, close } = openModal({
              label: message,
              className: 'dialog',
              onClose: () => resolve(answer),
            })
            panel.append(h(doc, 'div', { class: 'message' }, message), h(doc, 'div', { class: 'buttons' }, cancel, ok))
            ok.addEventListener('click', () => {
              answer = true
              close()
            })
            cancel.addEventListener('click', close)
            ok.focus()
          }),
      )
      dialogChain = result.catch(() => {})
      return result
    },

    mount(slot: GlobalSlot, render: Render) {
      const { host, container } = slotHost(`zb-slot zb-slot-${slot}`)
      const sidebar = slot === 'sidebar' ? options.sidebar?.() : undefined
      if (slot === 'overlay') {
        host.classList.add('overlay')
        ensureRoot().shadow.append(host)
        lockScroll(true)
      } else if (sidebar) sidebar.prepend(host)
      // 页面没有右侧栏时，放在右下角的工具栏里
      else ensureRoot().toolbar.append(host)
      let cleanup: unknown
      try {
        cleanup = render(container)
      } catch (e) {
        console.error('[zhihu-browser] 挂载界面出错', e)
      }
      const dispose = once(() => {
        disposers.delete(dispose)
        if (typeof cleanup === 'function') cleanup()
        container.replaceChildren()
        host.remove()
        if (slot === 'overlay') lockScroll(false)
      })
      disposers.add(dispose)
      return dispose
    },

    addStyle(css) {
      const dispose = injectStyle(doc, doc, css)
      const tracked = once(() => {
        disposers.delete(tracked)
        dispose()
      })
      disposers.add(tracked)
      return tracked
    },

    openModal,
    hasModal: () => !!modal,

    dispose() {
      for (const fn of [...disposers]) fn()
      themeObserver?.disconnect()
      root?.host.remove()
      root = undefined
    },
  }
  return ui
}
