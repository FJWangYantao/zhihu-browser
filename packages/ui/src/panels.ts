// 快捷键一览、插件状态与日志两个面板。

import {
  formatShortcut,
  HOST_OWNER,
  type HookKind,
  type Host,
  type Platform,
  type PluginInfo,
} from '@zhihu-browser/core'
import type { PageType } from '@zhihu-browser/sdk'
import type { Modal, PageUI } from './page-ui'
import { h } from './util'

const PAGE_NAMES: Record<PageType, string> = {
  home: '首页',
  follow: '关注',
  hot: '热榜',
  question: '问题页',
  answer: '回答页',
  article: '文章页',
  search: '搜索',
  people: '用户主页',
  collection: '收藏夹',
  pin: '想法',
  topic: '话题',
  video: '视频',
  other: '其他页面',
}

const HOOK_NAMES: Record<HookKind, string> = {
  entry: '启动',
  page: '页面钩子',
  filter: '过滤函数',
  content: '渲染钩子',
  comment: '评论钩子',
  command: '命令',
  shortcut: '快捷键',
  settings: '设置回调',
  ui: '界面回调',
  cleanup: '清理函数',
}

/** 插件 id → 显示名称；宿主自己是 zhihu-browser */
export function sourceName(host: Host, pluginId: string): string {
  return pluginId === HOST_OWNER ? 'zhihu-browser' : (host.plugin(pluginId)?.meta.name ?? pluginId)
}

function sheet(ui: PageUI, doc: Document, title: string, onClose?: () => void) {
  const modal = ui.openModal({ label: title, className: 'sheet', onClose })
  const closeButton = h(doc, 'button', { type: 'button', class: 'link' }, '关闭')
  closeButton.addEventListener('click', modal.close)
  const body = h(doc, 'div', { class: 'body' })
  modal.panel.append(h(doc, 'header', {}, h(doc, 'h2', {}, title), closeButton), body)
  return { modal, body }
}

/** 快捷键一览：按来源分组，标出冲突和停用的 */
export function openShortcutHelp(ui: PageUI, doc: Document, host: Host, platform: Platform): Modal {
  const { modal, body } = sheet(ui, doc, '快捷键')
  const shortcuts = host.shortcuts()
  if (!shortcuts.length) body.append(h(doc, 'p', { class: 'empty' }, '还没有插件注册快捷键'))
  const groups = new Map<string, typeof shortcuts>()
  for (const s of shortcuts) groups.set(s.pluginId, [...(groups.get(s.pluginId) ?? []), s])
  for (const [pluginId, items] of groups) {
    body.append(h(doc, 'h3', {}, sourceName(host, pluginId)))
    for (const s of items) {
      const notes: string[] = []
      if (s.when) notes.push(`只在${s.when.map(t => PAGE_NAMES[t]).join('、')}生效`)
      const warning = s.disabled
        ? '已在设置页停用'
        : s.conflictWith
          ? `和"${sourceName(host, s.conflictWith)}"的快捷键冲突，没有生效`
          : undefined
      body.append(
        h(
          doc,
          'div',
          { class: 'row' },
          h(
            doc,
            'div',
            { class: 'main' },
            h(doc, 'div', {}, s.description),
            notes.length ? h(doc, 'div', { class: 'note' }, notes.join('；')) : null,
            warning ? h(doc, 'div', { class: 'note warn' }, warning) : null,
          ),
          s.keys ? h(doc, 'kbd', {}, formatShortcut(s.keys, platform)) : null,
        ),
      )
    }
  }
  body.append(h(doc, 'p', { class: 'note' }, '焦点在输入框里时快捷键不起作用。可以在设置页修改快捷键。'))
  return modal
}

const STATE_LABELS: Record<PluginInfo['state'], string> = { active: '运行中', inactive: '没有运行', failed: '出错停用' }

function time(t: number): string {
  const d = new Date(t)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}

/** 插件状态与日志：运行状态、报错次数、耗时警告、最近的日志；出错停用的插件可以在当前页面重新启用 */
export function openPluginPanel(ui: PageUI, doc: Document, host: Host): Modal {
  let offState = () => {}
  const { modal, body } = sheet(ui, doc, '插件状态与日志', () => offState())

  function render(): void {
    const plugins = host.plugins()
    body.replaceChildren()
    if (!plugins.length) body.append(h(doc, 'p', { class: 'empty' }, '没有加载任何插件'))
    for (const p of plugins) {
      const notes: string[] = []
      if (p.state !== 'active' && p.reason) notes.push(p.reason)
      if (p.stats.errors) notes.push(`累计报错 ${p.stats.errors} 次`)
      if (p.stats.slow.length) notes.push(`${p.stats.slow.map(k => HOOK_NAMES[k]).join('、')}经常超出耗时预算`)
      const logs = host.logs(p.id).slice(-30)
      const retry =
        p.state === 'failed' ? h(doc, 'button', { type: 'button', class: 'link' }, '在这个页面重新启用') : null
      retry?.addEventListener('click', () => void host.enable(p.id).then(render))
      body.append(
        h(
          doc,
          'div',
          { class: 'row' },
          h(
            doc,
            'div',
            { class: 'main' },
            h(doc, 'div', {}, `${p.meta.name} `, h(doc, 'span', { class: 'note' }, p.meta.version)),
            notes.length
              ? h(doc, 'div', { class: `note${p.state === 'failed' ? ' warn' : ''}` }, notes.join('；'))
              : null,
            logs.length
              ? h(
                  doc,
                  'div',
                  { class: 'logs', role: 'log' },
                  ...logs.map(entry =>
                    h(doc, 'div', { 'data-level': entry.level }, `${time(entry.time)} ${entry.level} ${entry.message}`),
                  ),
                )
              : h(doc, 'div', { class: 'note' }, '没有日志'),
            retry,
          ),
          h(doc, 'span', { class: 'state', 'data-state': p.state }, STATE_LABELS[p.state]),
        ),
      )
    }
  }

  offState = host.on('pluginState', render)
  render()
  return modal
}

/** 报告文本框 + "复制"按钮：复制失败时选中全部内容，让用户手动复制 */
function reportBox(ui: PageUI, doc: Document, report: string, label: string, rows: string) {
  const text = h(doc, 'textarea', { class: 'report', readonly: '', rows, spellcheck: 'false', 'aria-label': label })
  text.value = report
  const copy = h(doc, 'button', { type: 'button', class: 'primary' }, '复制')
  copy.addEventListener('click', () => {
    const clipboard = doc.defaultView?.navigator.clipboard
    const fallback = () => {
      text.focus()
      text.select()
      ui.toast('没能自动复制，已选中全部内容，请按 Ctrl+C（macOS 上是 ⌘C）', { tone: 'warn' })
    }
    if (!clipboard) return fallback()
    clipboard.writeText(report).then(() => ui.toast('已复制', { tone: 'success' }), fallback)
  })
  return { text, copy }
}

/** 页面结构诊断：显示诊断信息，用户看过之后自己复制（扩展不会上传） */
export function openDiagnosePanel(ui: PageUI, doc: Document, report: string): Modal {
  const { modal, body } = sheet(ui, doc, '页面结构诊断')
  const { text, copy } = reportBox(ui, doc, report, '诊断信息', '14')
  body.append(
    h(
      doc,
      'p',
      { class: 'note' },
      '知乎页面上有功能没生效时，可以把下面的内容发给开发者，用来核对页面结构。只包含标签名、类名和尺寸，不含任何文字、链接和账号信息。',
    ),
    text,
    h(doc, 'div', { class: 'buttons' }, copy),
  )
  return modal
}

export interface SnapshotFile {
  /** 样本的文本 */
  text: string
  /** 下载时的文件名 */
  fileName: string
}

/** 页面样本：显示脱敏之后的样本，用户看过之后自己复制或下载（扩展不会上传） */
export function openSnapshotPanel(ui: PageUI, doc: Document, file: SnapshotFile): Modal {
  const { modal, body } = sheet(ui, doc, '采集页面样本')
  const { text, copy } = reportBox(ui, doc, file.text, '页面样本', '14')
  const download = h(doc, 'button', { type: 'button' }, '下载')
  download.addEventListener('click', () => {
    const win = doc.defaultView
    if (!win) return
    const url = win.URL.createObjectURL(new win.Blob([file.text], { type: 'application/json' }))
    const link = h(doc, 'a', { href: url, download: file.fileName })
    link.click()
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000)
  })
  body.append(
    h(
      doc,
      'p',
      { class: 'note' },
      '页面样本用来在知乎改版后核对适配层。页面上所有的文字都已换成占位符，内容 id、用户标识换成了编号，链接只保留站内路径的形状，不含图片、样式和账号信息；页面的标签名、类名和元素的位置大小保留。请先看一遍再分享，扩展不会上传。',
    ),
    text,
    h(doc, 'div', { class: 'buttons' }, copy, download),
  )
  return modal
}
