// 内容元素上的界面工具（ItemUI）：标签、折叠、操作按钮、自定义挂载点。
//
// - 折叠只改属性（data-zb-fold），由 styles.css 隐藏子元素并用伪元素显示原因。只改属性不会影响
//   知乎前端对服务端渲染内容的激活（hydration），所以可以立即生效，不会先闪一下再折叠。
// - 其余界面要往元素里插入节点，必须等知乎前端激活之后再插，否则激活时会和服务端渲染的结果对不上。
// - 知乎重新渲染元素的一部分时，插入的节点可能被带走，repair() 会把它们放回去。

import type { Dispose, ItemUI, Render } from '@zhihu-browser/sdk'
import { actionBarOf, badgeAnchorOf, bodyOf } from './anchors'

const noop: Dispose = () => {}

export function once(fn: () => void): Dispose {
  let done = false
  return () => {
    if (done) return
    done = true
    fn()
  }
}

// ---------- 折叠 ----------

interface FoldState {
  reasons: Map<number, string>
  open: boolean
  onClick: (event: MouseEvent) => void
}

const folds = new WeakMap<HTMLElement, FoldState>()
let foldSeq = 0
/** 展开后，顶部这么高的范围内点击会重新折叠 */
const FOLD_BAR_HEIGHT = 40

function renderFold(el: HTMLElement, state: FoldState): void {
  el.setAttribute('data-zb-fold', [...new Set(state.reasons.values())].join('；'))
  el.toggleAttribute('data-zb-fold-open', state.open)
}

/** 折叠元素，reason 显示在折叠后的那一行里。同一个元素可以有多个原因，全部撤销后才恢复。 */
export function addFold(el: HTMLElement, reason: string): Dispose {
  let state = folds.get(el)
  if (!state) {
    const s: FoldState = {
      reasons: new Map(),
      open: false,
      onClick(event) {
        // 折叠时子元素都隐藏了，点击落在元素自己身上；展开后只有顶部那一行可以点
        if (event.target !== el) return
        if (s.open && event.clientY - el.getBoundingClientRect().top > FOLD_BAR_HEIGHT) return
        event.preventDefault()
        event.stopPropagation()
        s.open = !s.open
        renderFold(el, s)
      },
    }
    state = s
    folds.set(el, s)
    el.addEventListener('click', s.onClick, true)
  }
  const current = state
  const id = ++foldSeq
  current.reasons.set(id, reason)
  renderFold(el, current)
  return once(() => {
    current.reasons.delete(id)
    if (current.reasons.size) {
      renderFold(el, current)
      return
    }
    el.removeEventListener('click', current.onClick, true)
    el.removeAttribute('data-zb-fold')
    el.removeAttribute('data-zb-fold-open')
    folds.delete(el)
  })
}

/** 元素处于折叠状态（有折叠原因并且没有被用户展开） */
export function isFolded(el: HTMLElement): boolean {
  const state = folds.get(el)
  return !!state && !state.open
}

/** 展开被折叠的元素（例如插件调用 handle.expand()） */
export function openFold(el: HTMLElement): void {
  const state = folds.get(el)
  if (!state || state.open) return
  state.open = true
  renderFold(el, state)
}

// ---------- 插入节点的界面 ----------

export interface DecorEnv {
  /** 知乎前端激活之后执行；已经激活时立即执行。返回取消函数。 */
  whenHydrated(fn: () => void): Dispose
}

interface Placement {
  place(): void
  remove(): void
  /** 节点被知乎的重新渲染带走了 */
  detached(): boolean
}

export interface DomItemUI extends ItemUI {
  /** 把被带走的节点放回去 */
  repair(): void
}

const badgeBoxes = new WeakMap<HTMLElement, HTMLElement>()
const actionRows = new WeakMap<HTMLElement, HTMLElement>()

function uiElement<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string) {
  const el = doc.createElement(tag)
  el.className = className
  el.setAttribute('data-zb-ui', '')
  return el
}

function removeIfEmpty(box: HTMLElement | null, map: WeakMap<HTMLElement, HTMLElement>, owner: HTMLElement): void {
  if (box && box.childElementCount === 0 && map.get(owner) === box) {
    box.remove()
    map.delete(owner)
  }
}

/**
 * 为一个元素创建界面工具。signal 中止时（元素被移除、被过滤、插件停用），通过它添加的界面全部撤销。
 */
export function createItemUI(
  el: HTMLElement,
  signal: AbortSignal,
  env: DecorEnv,
  kind: 'content' | 'comment' = 'content',
): DomItemUI {
  const doc = el.ownerDocument
  const placed = new Set<Placement>()
  const inside = (node: Node) => node.isConnected && el.contains(node)

  function decorate(p: Placement): Dispose {
    if (signal.aborted) return noop
    let attached = false
    let cancel = noop
    const dispose = once(() => {
      cancel()
      signal.removeEventListener('abort', dispose)
      placed.delete(p)
      if (attached) p.remove()
    })
    signal.addEventListener('abort', dispose, { once: true })
    cancel = env.whenHydrated(() => {
      p.place()
      attached = true
      placed.add(p)
    })
    return dispose
  }

  function badgeBox(): HTMLElement {
    let box = badgeBoxes.get(el)
    if (!box) {
      box = uiElement(doc, 'span', 'zb-badges')
      badgeBoxes.set(el, box)
    }
    if (!inside(box)) {
      const { parent, before } = badgeAnchorOf(el, kind)
      parent.insertBefore(box, before)
    }
    return box
  }

  function actionRow(): HTMLElement {
    let row = actionRows.get(el)
    if (!row) {
      row = uiElement(doc, kind === 'comment' ? 'span' : 'div', 'zb-actions')
      actionRows.set(el, row)
    }
    if (!inside(row)) {
      if (kind === 'comment') {
        const { parent, before } = badgeAnchorOf(el, 'comment')
        parent.insertBefore(row, before)
      } else el.append(row)
    }
    return row
  }

  return {
    badge(text, options) {
      const span = uiElement(doc, 'span', 'zb-badge')
      span.textContent = text
      if (options?.tone) span.setAttribute('data-tone', options.tone)
      if (options?.title) span.title = options.title
      return decorate({
        place: () => badgeBox().append(span),
        remove() {
          const box = span.parentElement
          span.remove()
          removeIfEmpty(box, badgeBoxes, el)
        },
        detached: () => !inside(span),
      })
    },

    fold(reason) {
      if (signal.aborted) return noop
      const remove = addFold(el, reason)
      const dispose = once(() => {
        signal.removeEventListener('abort', dispose)
        remove()
      })
      signal.addEventListener('abort', dispose, { once: true })
      return dispose
    },

    addAction(action) {
      const button = uiElement(doc, 'button', 'zb-action')
      button.type = 'button'
      button.textContent = action.label
      if (action.title) button.title = action.title
      button.addEventListener('click', event => {
        // 不要触发知乎卡片自己的点击（例如点击卡片展开全文）
        event.preventDefault()
        event.stopPropagation()
        action.onClick()
      })
      return decorate({
        place() {
          const bar = kind === 'content' ? actionBarOf(el) : undefined
          if (bar) {
            // 借用知乎按钮的样式，和"赞同""评论"等按钮保持一致
            button.className = 'zb-action Button ContentItem-action Button--plain'
            bar.append(button)
          } else {
            button.className = 'zb-action'
            actionRow().append(button)
          }
        },
        remove() {
          const row = button.parentElement
          button.remove()
          removeIfEmpty(row, actionRows, el)
        },
        detached: () => !inside(button),
      })
    },

    mount(position, render: Render) {
      const host = uiElement(doc, 'div', 'zb-mount')
      const container = doc.createElement('div')
      host.attachShadow({ mode: 'open' }).append(container)
      let rendered = false
      let cleanup: unknown
      return decorate({
        place() {
          const body = bodyOf(el)
          if (body?.parentNode && el.contains(body)) {
            body.parentNode.insertBefore(host, position === 'before' ? body : body.nextSibling)
          } else if (position === 'before') el.insertBefore(host, el.firstChild)
          else el.append(host)
          if (!rendered) {
            rendered = true
            cleanup = render(container)
          }
        },
        remove() {
          host.remove()
          if (typeof cleanup === 'function') cleanup()
          container.replaceChildren()
        },
        detached: () => !inside(host),
      })
    },

    repair() {
      for (const p of [...placed]) if (p.detached()) p.place()
    },
  }
}
