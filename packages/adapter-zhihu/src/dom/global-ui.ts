// 全局界面：提示、确认框、全局挂载点（toolbar / sidebar / overlay），以及全局样式。
// 界面都放在 Shadow DOM 里，知乎的样式影响不到，也不会漏到知乎页面上。

import type { Dispose, GlobalSlot, GlobalUI, Render } from '@zhihu-browser/sdk'
import { SIDEBAR_SELECTOR } from './anchors'
import { once } from './item-ui'

const ROOT_CSS = `
:host { all: initial; }
.toolbar {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
}
.toasts {
  position: fixed; left: 50%; top: 72px; transform: translateX(-50%); z-index: 2147483600;
  display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none;
}
.toast {
  max-width: min(480px, calc(100vw - 32px)); padding: 10px 16px; border-radius: 8px;
  font: 14px/20px -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #fff; background: rgba(18, 18, 18, 0.88); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
.toast[data-tone="success"] { background: #0a8c55; }
.toast[data-tone="warn"] { background: #b86200; }
.toast[data-tone="error"] { background: #c33; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483500; background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center;
}
.dialog {
  width: min(400px, calc(100vw - 32px)); box-sizing: border-box; padding: 24px; border-radius: 12px;
  font: 15px/24px -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--zb-color-text, #121212); background: var(--zb-color-surface, #fff);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
}
.message { white-space: pre-wrap; word-break: break-word; }
.buttons { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
button {
  font: inherit; font-size: 14px; padding: 6px 16px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--zb-color-border, #d3d3d3); background: transparent; color: inherit;
}
button.primary { border-color: var(--zb-color-accent, #056de8); background: var(--zb-color-accent, #056de8); color: #fff; }
button:focus-visible { outline: 2px solid var(--zb-color-accent, #056de8); outline-offset: 2px; }
.overlay {
  position: fixed; inset: 0; z-index: 2147483400; overflow: auto;
  background: var(--zb-color-bg, #fff);
}
`

/** 全局界面，加上全局样式 */
export interface PageUI extends GlobalUI {
  addStyle(css: string): Dispose
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

/**
 * 注入样式：优先用 adoptedStyleSheets（不受页面 CSP 的 style-src 限制），不支持时退回 <style>。
 */
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

export function createPageUI(doc: Document): PageUI {
  let root: Root | undefined
  let overlays = 0
  let savedOverflow = ''
  let dialogChain: Promise<unknown> = Promise.resolve()
  const disposers = new Set<Dispose>()

  function ensureRoot(): Root {
    if (root?.host.isConnected) return root
    const host = doc.createElement('div')
    host.id = 'zb-root'
    host.setAttribute('data-zb-ui', '')
    const shadow = host.attachShadow({ mode: 'open' })
    injectStyle(doc, shadow, ROOT_CSS)
    const toolbar = doc.createElement('div')
    toolbar.className = 'toolbar'
    const toasts = doc.createElement('div')
    toasts.className = 'toasts'
    shadow.append(toolbar, toasts)
    ;(doc.body ?? doc.documentElement).append(host)
    root = { host, shadow, toolbar, toasts }
    return root
  }

  /** 每个挂载点一个独立的 Shadow DOM，插件之间的样式互不影响 */
  function slotHost(className: string) {
    const host = doc.createElement('div')
    host.className = className
    host.setAttribute('data-zb-ui', '')
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

  const ui: PageUI = {
    toast(message, options = {}) {
      const { toasts } = ensureRoot()
      const el = doc.createElement('div')
      el.className = 'toast'
      el.setAttribute('role', 'status')
      el.setAttribute('data-tone', options.tone ?? 'info')
      el.textContent = message
      toasts.append(el)
      const duration = Math.min(Math.max(options.duration ?? 3000, 1000), 30_000)
      const timer = setTimeout(() => el.remove(), duration)
      disposers.add(() => clearTimeout(timer))
    },

    confirm(message, options = {}) {
      // 同一时间只显示一个确认框，后来的排队
      const result = dialogChain.then(
        () =>
          new Promise<boolean>(resolve => {
            const { shadow } = ensureRoot()
            const backdrop = doc.createElement('div')
            backdrop.className = 'backdrop'
            const dialog = doc.createElement('div')
            dialog.className = 'dialog'
            dialog.setAttribute('role', 'dialog')
            dialog.setAttribute('aria-modal', 'true')
            const text = doc.createElement('div')
            text.className = 'message'
            text.textContent = message
            const buttons = doc.createElement('div')
            buttons.className = 'buttons'
            const cancel = doc.createElement('button')
            cancel.textContent = options.cancelText ?? '取消'
            const ok = doc.createElement('button')
            ok.className = 'primary'
            ok.textContent = options.okText ?? '确定'
            buttons.append(cancel, ok)
            dialog.append(text, buttons)
            backdrop.append(dialog)

            let settled = false
            const finish = (value: boolean) => {
              if (settled) return
              settled = true
              backdrop.remove()
              doc.removeEventListener('keydown', onKey, true)
              disposers.delete(abort)
              resolve(value)
            }
            const abort = () => finish(false)
            const onKey = (event: KeyboardEvent) => {
              if (event.key !== 'Escape') return
              event.stopPropagation()
              finish(false)
            }
            ok.addEventListener('click', () => finish(true))
            cancel.addEventListener('click', () => finish(false))
            backdrop.addEventListener('click', event => {
              if (event.target === backdrop) finish(false)
            })
            doc.addEventListener('keydown', onKey, true)
            disposers.add(abort)
            shadow.append(backdrop)
            ok.focus()
          }),
      )
      dialogChain = result.catch(() => {})
      return result
    },

    mount(slot: GlobalSlot, render: Render) {
      const { host, container } = slotHost(`zb-slot zb-slot-${slot}`)
      if (slot === 'overlay') {
        host.classList.add('overlay')
        ensureRoot().shadow.append(host)
        lockScroll(true)
      } else if (slot === 'sidebar' && doc.querySelector(SIDEBAR_SELECTOR)) {
        doc.querySelector(SIDEBAR_SELECTOR)?.prepend(host)
      } else {
        // 页面没有右侧栏时，放在右下角的工具栏里
        ensureRoot().toolbar.append(host)
      }
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

    dispose() {
      for (const fn of [...disposers]) fn()
      root?.host.remove()
      root = undefined
    },
  }
  return ui
}
