// 页面角落的提示：锚点健康检查不通过时显示"知乎页面结构可能已变化"（plan.md 5.4）。
// 可以一键复制诊断信息用于提交 issue（只在本机复制，扩展不会上传），也可以忽略。

import { FEATURE_NAMES, type FeatureId } from '../health'

export interface HealthNotice {
  /** 被停用的功能变了之后更新文字 */
  update(disabled: readonly FeatureId[]): void
  dispose(): void
}

export interface HealthNoticeOptions {
  /** 被停用的功能 */
  disabled: readonly FeatureId[]
  /** 生成诊断信息（纯文本），复制按钮用 */
  diagnose: () => string
  /** 用户点了"忽略" */
  onDismiss?: () => void
}

/** 放左下角（知乎自己的悬浮按钮一般在右下角）；样式在 styles.css */
export function showHealthNotice(doc: Document, options: HealthNoticeOptions): HealthNotice {
  const el = doc.createElement('div')
  el.className = 'zb-health-notice'
  el.setAttribute('data-zb-ui', '')
  el.setAttribute('role', 'status')

  const text = doc.createElement('span')
  text.className = 'zb-health-text'
  const copy = doc.createElement('button')
  copy.type = 'button'
  copy.className = 'zb-health-copy'
  copy.textContent = '复制诊断信息'
  const close = doc.createElement('button')
  close.type = 'button'
  close.className = 'zb-health-close'
  close.setAttribute('aria-label', '忽略')
  close.textContent = '×'
  el.append(text, copy, close)
  doc.body?.append(el)

  const update = (disabled: readonly FeatureId[]) => {
    const names = disabled.map(f => FEATURE_NAMES[f]).join('、')
    text.textContent = `知乎页面结构可能已变化，已停用：${names}。页面照常可用，其余功能不受影响。`
  }
  update(options.disabled)

  copy.addEventListener('click', () => {
    const report = options.diagnose()
    const win = doc.defaultView
    const setLabel = (ok: boolean) => {
      copy.textContent = ok ? '已复制，感谢反馈' : '复制失败，可在命令面板里复制'
    }
    const fallback = () => {
      // 没有剪贴板权限（或复制被拒绝）时，用选中文本的老办法
      const area = doc.createElement('textarea')
      area.value = report
      area.className = 'zb-health-fallback'
      area.setAttribute('data-zb-ui', '')
      area.readOnly = true
      doc.body?.append(area)
      area.focus()
      area.select()
      let ok = false
      try {
        ok = doc.execCommand('copy')
      } catch {
        ok = false
      }
      area.remove()
      setLabel(ok)
    }
    const clipboard = win?.navigator.clipboard
    if (!clipboard) return fallback()
    clipboard.writeText(report).then(() => setLabel(true), fallback)
  })

  close.addEventListener('click', () => {
    dispose()
    options.onDismiss?.()
  })

  function dispose(): void {
    el.remove()
  }
  return { update, dispose }
}
