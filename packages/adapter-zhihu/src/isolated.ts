// 扩展隔离环境（ISOLATED world）部分：适配层的主体。
//
// 在 document_start 创建（createAdapter）：打开预隐藏、开始观察页面、读取首屏数据；
// 插件加载完之后启动（start）：处理页面主环境转来的接口响应，识别页面上的内容元素，交给宿主。

import type { Host, HostServices } from '@zhihu-browser/core'
import type { Comment, Content, ContentHandle, Dispose, PageInfo } from '@zhihu-browser/sdk'
import { ASK_REACT, open, type ReactRef, TO_ISOLATED, TO_MAIN, type ToIsolated, type ToMain } from './bridge'
import { describePage } from './diagnose'
import {
  COMMENT_SELECTOR,
  CONTENT_SELECTOR,
  containerOf,
  contentFromDom,
  identify,
  isContentElement,
} from './dom/anchors'
import { type DarkPatch, startDarkPatch } from './dom/dark-patch'
import { createHandle, HEADER_OFFSET } from './dom/handle'
import { addFold, createItemUI, type DecorEnv, type DomItemUI } from './dom/item-ui'
import { type Columns, findColumns } from './dom/layout'
import { classify, type Filters, processResponse } from './endpoints'
import { keyOf } from './refs'
import { isSubject, pageInfo } from './routes'
import { ContentStore } from './store'
import { createThemeSync, type ThemeSync } from './theme'
import { withoutHash } from './util'

export interface AdapterOptions {
  document?: Document
  /** 插件迟迟没有加载完时，最多预隐藏多久（毫秒），默认 1500 */
  prehideTimeout?: number
  /** 页面主环境一直没有报告知乎前端已激活时，最多等多久再往元素里插入界面（毫秒），默认 10000 */
  hydrationTimeout?: number
  /** 兜底检查地址变化的间隔（毫秒），默认 1000 */
  routePollInterval?: number
}

export interface Adapter {
  /** 当前页面上已识别的内容，交给宿主 */
  readonly contents: HostServices['contents']
  readonly store: ContentStore
  /** 主题 token 的映射：插件的样式有增减之后调用 theme.sync()（见 syncingStyles） */
  readonly theme: ThemeSync
  /** 页面结构诊断（纯文本，只有标签名、类名和尺寸），version 是扩展的版本 */
  describe(version?: string): string
  /** 插件已经加载：开始处理接口响应和页面元素 */
  start(host: Host): void
  dispose(): void
}

interface Tracked {
  el: HTMLElement
  /** 'answer:123' 或 'comment:456' */
  key: string
  kind: 'content' | 'comment'
  content?: Content
  comment?: Comment
  /** 被过滤时隐藏的元素 */
  container: HTMLElement
  handle?: ContentHandle
  /** 显示中：插件的渲染钩子拿到的 signal 和界面工具 */
  live?: { controller: AbortController; ui: DomItemUI }
  /** 为了不让整页变空而保留、在页面上折叠的条目 */
  unfold?: Dispose
}

/** 这些页面上的内容按信息流过滤 */
const FEED_PAGES = new Set<PageInfo['type']>(['home', 'follow', 'hot', 'topic'])
/** 我们自己插入的界面元素，不需要扫描 */
const OURS = '[data-zb-ui]'
const noop: Dispose = () => {}

export function createAdapter(options: AdapterOptions = {}): Adapter {
  const doc = options.document ?? document
  const win = doc.defaultView ?? window
  const store = new ContentStore()
  const tracked = new Map<Element, Tracked>()
  const pending = new Set<Element>()
  const cleanups: (() => void)[] = []
  let host: Host | undefined
  let page: PageInfo = pageInfo(win.location.href)
  let initialDataDone = false
  let hydrated = false
  const hydrationQueue = new Set<() => void>()
  let lastReact: ReactRef[] = []
  let disposed = false
  // 主题要求隐藏右侧栏时，按位置找右侧栏（见 markColumns）；要求暗色时，补上没跟着变暗的模块（见 dom/dark-patch.ts）
  const theme = createThemeSync(doc, {
    onChange: () => {
      scheduleColumns()
      syncDarkPatch()
    },
  })
  let columns: Columns | undefined
  let columnsTimer: number | undefined
  let darkPatch: DarkPatch | undefined
  cleanups.push(() => {
    darkPatch?.dispose()
    darkPatch = undefined
  })
  cleanups.push(theme.dispose)

  // ---------- 预隐藏：处理完之前先隐藏内容卡片（样式在 styles.css） ----------

  doc.documentElement?.setAttribute('data-zb-prehide', '')
  const prehideTimer = win.setTimeout(() => {
    // 插件迟迟没有加载完：先让页面能用
    if (!host) doc.documentElement?.removeAttribute('data-zb-prehide')
  }, options.prehideTimeout ?? 1500)
  cleanups.push(() => win.clearTimeout(prehideTimer))

  // ---------- 知乎前端激活之后才往元素里插入界面 ----------

  function markHydrated(): void {
    if (hydrated) return
    hydrated = true
    for (const fn of [...hydrationQueue]) {
      hydrationQueue.delete(fn)
      try {
        fn()
      } catch (e) {
        console.error('[zhihu-browser] 插入界面出错', e)
      }
    }
  }
  const hydrationTimer = win.setTimeout(markHydrated, options.hydrationTimeout ?? 10_000)
  cleanups.push(() => win.clearTimeout(hydrationTimer))

  const env: DecorEnv = {
    whenHydrated(fn) {
      if (hydrated) {
        fn()
        return noop
      }
      hydrationQueue.add(fn)
      return () => hydrationQueue.delete(fn)
    },
  }

  // ---------- 与页面主环境的通道 ----------

  const channel = open<ToIsolated, ToMain>(doc, TO_ISOLATED, TO_MAIN, ({ head, body }) => {
    switch (head.type) {
      case 'hello':
        if (host) channel.send({ type: 'ready' })
        break
      case 'route':
        onRoute(head.url)
        break
      case 'hydrated':
        markHydrated()
        break
      case 'react':
        lastReact = Array.isArray(head.refs) ? head.refs : []
        break
      case 'response': {
        const text = handleResponse(head.url, body)
        channel.send({ type: 'reply', id: head.id, changed: text !== undefined }, text)
        break
      }
    }
  })
  cleanups.push(channel.close)

  /** 处理接口响应；需要改写时返回新的响应原文 */
  function handleResponse(url: string, text: string): string | undefined {
    const h = host
    if (!h) return undefined
    try {
      const endpoint = classify(url)
      if (!endpoint) return undefined
      const json: unknown = JSON.parse(text)
      const filters: Filters = {}
      if (h.hasFilters('feed')) filters.feed = item => h.shouldKeep('feed', item)
      if (h.hasFilters('answers')) filters.answers = item => h.shouldKeep('answers', item)
      if (h.hasFilters('search')) filters.search = item => h.shouldKeep('search', item)
      if (h.hasFilters('comments')) filters.comments = item => h.shouldKeep('comments', item)
      return processResponse(json, endpoint, store, filters).changed ? JSON.stringify(json) : undefined
    } catch (e) {
      console.warn('[zhihu-browser] 处理接口响应出错，已原样放行', e)
      return undefined
    }
  }

  function askReact(el: Element): ReactRef[] {
    lastReact = []
    el.dispatchEvent(new win.CustomEvent(ASK_REACT, { bubbles: true }))
    const refs = lastReact
    lastReact = []
    return refs
  }

  // ---------- 首屏数据 ----------

  function tryInitialData(final = false): void {
    if (initialDataDone) return
    const script = doc.getElementById('js-initialData')
    if (script) {
      try {
        store.absorbInitialData(JSON.parse(script.textContent ?? ''))
        initialDataDone = true
      } catch {
        // 脚本还没解析完，等下一次
      }
    }
    if (final) initialDataDone = true
    if (initialDataDone) flushPending()
  }
  if (doc.readyState === 'loading') {
    const onReady = () => tryInitialData(true)
    doc.addEventListener('DOMContentLoaded', onReady, { once: true })
    cleanups.push(() => doc.removeEventListener('DOMContentLoaded', onReady))
  } else tryInitialData(true)

  // ---------- 观察页面 ----------

  /** 插件已经加载、首屏数据已经读到（或者页面已经解析完）才开始处理元素 */
  function canProcess(): boolean {
    return !!host && initialDataDone && !disposed
  }

  function enqueue(el: Element): void {
    if (tracked.has(el)) return
    if (canProcess()) process(el)
    else pending.add(el)
  }

  function flushPending(): void {
    if (!canProcess()) return
    const els = [...pending]
    pending.clear()
    for (const el of els) if (el.isConnected) process(el)
  }

  function scan(root: Element): void {
    if (!root.isConnected || root.matches(OURS)) return
    const contents = root.matches(CONTENT_SELECTOR) ? [root] : []
    contents.push(...root.querySelectorAll(CONTENT_SELECTOR))
    for (const el of contents) {
      if (isContentElement(el)) enqueue(el)
      // 嵌套在另一块内容里的元素随外层一起处理；也要打上标记，否则预隐藏会一直藏着它
      else el.setAttribute('data-zb-done', '')
    }
    if (!store.hasComments()) return
    const comments = root.matches(COMMENT_SELECTOR) ? [root] : []
    comments.push(...root.querySelectorAll(COMMENT_SELECTOR))
    for (const el of comments) {
      const id = el.getAttribute('data-id')
      if (id && store.comment(id) && !el.matches(CONTENT_SELECTOR)) enqueue(el)
    }
  }

  function onMutations(records: MutationRecord[]): void {
    if (disposed) return
    try {
      handleMutations(records)
    } catch (e) {
      // 出了意外就关掉预隐藏，保证页面内容能显示出来
      console.error('[zhihu-browser] 处理页面变化出错', e)
      doc.documentElement?.removeAttribute('data-zb-prehide')
    }
  }

  function handleMutations(records: MutationRecord[]): void {
    if (!initialDataDone) tryInitialData()
    const roots = new Set<Element>()
    const touched = new Set<Tracked>()
    let removed = false
    for (const record of records) {
      if (record.type === 'attributes') {
        // data-zop / data-id 变了：知乎复用了元素来显示另一块内容，重新识别
        const el = record.target as Element
        const item = tracked.get(el)
        if (item) untrack(item)
        roots.add(el)
        continue
      }
      if (record.removedNodes.length) removed = true
      for (const node of record.addedNodes) {
        if (node.nodeType === 1 && !(node as Element).matches(OURS)) roots.add(node as Element)
      }
      const target = record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement
      const owner = target?.closest('[data-zb-id]')
      const item = owner ? tracked.get(owner) : undefined
      if (item?.live) touched.add(item)
    }
    if (removed) {
      for (const item of [...tracked.values()]) if (!item.el.isConnected) untrack(item)
      for (const el of [...pending]) if (!el.isConnected) pending.delete(el)
    }
    for (const root of roots) scan(root)
    for (const item of touched) item.live?.ui.repair()
    scheduleColumns()
  }

  const observer = new win.MutationObserver(onMutations)
  observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-zop', 'data-id'] })
  cleanups.push(() => observer.disconnect())
  if (doc.documentElement) scan(doc.documentElement)

  // ---------- 元素：识别、过滤、交给宿主 ----------

  function process(el: Element): void {
    if (tracked.has(el) || !(el instanceof win.HTMLElement)) return
    try {
      if (el.matches(CONTENT_SELECTOR)) trackContent(el)
      else trackComment(el)
    } catch (e) {
      console.warn('[zhihu-browser] 处理页面元素出错', e)
    } finally {
      // 无论识别成功与否都要标记，否则预隐藏会一直藏着它
      el.setAttribute('data-zb-done', '')
    }
  }

  function trackContent(el: HTMLElement): void {
    const ref = identify(el, page, { has: key => store.hasContent(key), askReact })
    if (!ref) return
    const key = keyOf(ref)
    const item: Tracked = {
      el,
      key,
      kind: 'content',
      content: store.content(key) ?? contentFromDom(el, ref),
      container: containerOf(el),
    }
    item.handle = createHandle(el, () => item.content as Content)
    tracked.set(el, item)
    el.setAttribute('data-zb-id', key)
    apply(item)
  }

  function trackComment(el: HTMLElement): void {
    const id = el.getAttribute('data-id')
    const comment = id ? store.comment(id) : undefined
    if (!comment) return
    const item: Tracked = { el, key: `comment:${comment.id}`, kind: 'comment', comment, container: el }
    tracked.set(el, item)
    el.setAttribute('data-zb-id', item.key)
    apply(item)
  }

  /** 按当前的过滤函数决定是否保留 */
  function keep(item: Tracked): boolean {
    const h = host
    if (!h) return true
    if (item.kind === 'comment') {
      return !item.comment || !h.hasFilters('comments') || h.shouldKeep('comments', item.comment)
    }
    const content = item.content
    if (!content || isSubject(content, page)) return true
    if (FEED_PAGES.has(page.type)) {
      if (!h.hasFilters('feed')) return true
      return h.shouldKeep('feed', store.feedItem(item.key) ?? { id: item.key, kind: 'content', content })
    }
    if (page.type === 'question' || page.type === 'answer') {
      return content.type !== 'answer' || !h.hasFilters('answers') || h.shouldKeep('answers', content)
    }
    if (page.type === 'search') {
      if (!h.hasFilters('search')) return true
      return h.shouldKeep('search', store.searchResult(item.key) ?? { id: item.key, kind: 'content', content })
    }
    return true
  }

  function apply(item: Tracked): void {
    if (keep(item)) {
      item.container.removeAttribute('data-zb-hidden')
      item.unfold?.()
      item.unfold = undefined
      if (!item.live) goLive(item)
      return
    }
    // 被过滤：插件添加的界面随 signal 撤销
    item.live?.controller.abort()
    item.live = undefined
    if (store.isFolded(item.key)) {
      item.container.removeAttribute('data-zb-hidden')
      item.unfold ??= addFold(item.el, '已过滤')
    } else {
      item.unfold?.()
      item.unfold = undefined
      item.container.setAttribute('data-zb-hidden', '')
    }
  }

  function goLive(item: Tracked): void {
    const h = host
    if (!h) return
    const controller = new AbortController()
    const itemUi = createItemUI(item.el, controller.signal, env, item.kind)
    item.live = { controller, ui: itemUi }
    const target = { el: item.el, ui: itemUi, signal: controller.signal }
    if (item.content && item.handle) h.addContent(item.content, { ...target, handle: item.handle })
    else if (item.comment) h.addComment(item.comment, target)
  }

  function untrack(item: Tracked): void {
    tracked.delete(item.el)
    item.live?.controller.abort()
    item.live = undefined
    item.unfold?.()
    item.unfold = undefined
    item.container.removeAttribute('data-zb-hidden')
  }

  function reevaluate(): void {
    for (const item of [...tracked.values()]) apply(item)
  }

  // ---------- 页面切换 ----------

  function onRoute(url: string): void {
    if (disposed || withoutHash(url) === withoutHash(page.url)) return
    page = pageInfo(url)
    if (!host) return
    host.setPage(page)
    reevaluate()
  }

  // ---------- 当前页面上的内容 ----------

  const shown = () =>
    [...tracked.values()]
      .filter(t => t.kind === 'content' && t.live && t.handle && t.el.isConnected)
      .sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 /* DOCUMENT_POSITION_FOLLOWING */ ? -1 : 1))

  const contents: HostServices['contents'] = {
    all: () => shown().map(t => t.handle as ContentHandle),
    current() {
      for (const t of shown()) {
        const rect = t.el.getBoundingClientRect()
        if (rect.height > 0 && rect.bottom > HEADER_OFFSET) return t.handle
      }
      return undefined
    },
  }

  // ---------- 暗色补丁：插件要求暗色时运行 ----------

  function syncDarkPatch(): void {
    const want = !disposed && doc.documentElement?.getAttribute('data-zb-scheme') === 'dark'
    if (want && !darkPatch) darkPatch = startDarkPatch(doc)
    else if (!want && darkPatch) {
      darkPatch.dispose()
      darkPatch = undefined
    }
  }

  // ---------- 两栏布局：主题隐藏右侧栏时，按位置找右侧栏并做标记（样式在 theme.css） ----------

  const hidingSidebar = () => doc.documentElement?.getAttribute('data-zb-sidebar') === 'none'

  function scheduleColumns(): void {
    if (columnsTimer !== undefined || disposed || !hidingSidebar()) return
    columnsTimer = win.setTimeout(() => {
      columnsTimer = undefined
      markColumns()
    }, 100)
  }

  function markColumns(): void {
    if (disposed || !hidingSidebar()) return
    // 问题页顶部的问题横跨整个页面，从下面的回答开始找
    const start = shown().find(t => !t.el.matches('.QuestionHeader'))?.el
    if (!start) return
    // 已经找到、并且还是这一页的布局（右侧栏隐藏之后就没有位置可比了，所以不重新找）
    if (columns?.side.isConnected && columns.container.contains(start)) return
    const found = findColumns(start)
    if (!found) return
    clearColumns()
    columns = found
    found.container.setAttribute('data-zb-columns', '')
    found.side.setAttribute('data-zb-side', '')
  }

  function clearColumns(): void {
    columns?.container.removeAttribute('data-zb-columns')
    columns?.side.removeAttribute('data-zb-side')
    columns = undefined
  }

  cleanups.push(() => {
    win.clearTimeout(columnsTimer)
    clearColumns()
  })

  return {
    contents,
    store,
    theme,

    describe(version) {
      const start = shown().find(t => !t.el.matches('.QuestionHeader'))?.el
      return describePage(doc, { page, version, start })
    },

    start(h) {
      if (host || disposed) return
      host = h
      h.setPage(page)
      cleanups.push(h.on('filtersChanged', reevaluate))
      channel.send({ type: 'ready' })
      flushPending()
      scheduleColumns()
      // 兜底：页面主环境的路由通知丢了也能发现页面切换
      const check = () => onRoute(win.location.href)
      win.addEventListener('popstate', check)
      const poll = win.setInterval(check, options.routePollInterval ?? 1000)
      cleanups.push(() => {
        win.removeEventListener('popstate', check)
        win.clearInterval(poll)
      })
    },

    dispose() {
      if (disposed) return
      disposed = true
      for (const fn of cleanups.reverse()) fn()
      for (const item of [...tracked.values()]) untrack(item)
      pending.clear()
      hydrationQueue.clear()
      doc.documentElement?.removeAttribute('data-zb-prehide')
    },
  }
}
