// fixtures 测试的工具：把页面样本（snapshot.ts 采集的）装进 happy-dom，检查适配层能不能正确识别。
// 采集的样本放在 test/pages/，见 docs/fixtures.md。

import type { PageInfo } from '@zhihu-browser/sdk'
import { describeElement } from '../src/diagnose'
import { COMMENT_SELECTOR, CONTENT_SELECTOR, identify, isContentElement } from '../src/dom/anchors'
import { findColumns } from '../src/dom/layout'
import { checkAnchors, type HealthStage } from '../src/health'
import { pageInfo } from '../src/routes'
import { auditSnapshot, type PageSnapshot } from '../src/snapshot'

export interface LoadedSample {
  page: PageInfo
  /** 采集时实体仓库里的键 */
  entities: Set<string>
}

/** 把样本装进当前文档：属性、内容、元素的位置和大小（getBoundingClientRect 按 data-rect 返回） */
export function loadSample(sample: PageSnapshot): LoadedSample {
  const { documentElement: root, body } = document
  for (const el of [root, body]) for (const a of [...el.attributes]) el.removeAttribute(a.name)
  for (const [name, value] of Object.entries(sample.root)) root.setAttribute(name, value)
  for (const [name, value] of Object.entries(sample.body)) body.setAttribute(name, value)
  body.innerHTML = sample.html.join('')
  for (const el of [body, ...body.querySelectorAll('[data-rect]')]) {
    const [x = 0, y = 0, w = 0, h = 0] = (el.getAttribute('data-rect') ?? '').split(',').map(Number)
    el.getBoundingClientRect = () =>
      ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect
  }
  return { page: pageInfo(sample.url), entities: new Set(sample.entities) }
}

/** 页面上的内容元素（不含嵌套在另一块内容里的） */
export function contentElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(CONTENT_SELECTOR)].filter(isContentElement)
}

/** 样本里能对应到实体仓库的评论元素 */
export function commentElements(entities: ReadonlySet<string>): Element[] {
  return [...document.querySelectorAll(COMMENT_SELECTOR)].filter(
    el => entities.has(`comment:${el.getAttribute('data-id')}`) && !el.matches(CONTENT_SELECTOR),
  )
}

/** 适配层对样本的判断，逐项检查；返回发现的问题（没有问题时是空数组） */
export function checkSample(sample: PageSnapshot): string[] {
  const problems: string[] = []
  if (sample.format !== 1) return [`不认识的样本格式 ${sample.format}`]
  for (const p of auditSnapshot(document, sample)) problems.push(`脱敏检查：${p}`)

  const { page, entities } = loadSample(sample)

  // 锚点健康检查：声明过的锚点在这类页面上都应该命中
  for (const stage of ['contents', 'hydrated'] as HealthStage[]) {
    const report = checkAnchors(document, page, stage)
    for (const a of report?.anchors ?? []) {
      if (!a.healthy) problems.push(`锚点 ${a.selector}（${stage}）命中 ${a.matched} 个，期望 ${a.expected}`)
    }
  }

  // 每一块内容都应该能认出是哪块内容；有实体数据时，还应该能在数据里找到
  const contents = contentElements()
  for (const el of contents) {
    const ref = identify(el, page, { has: key => entities.has(key) })
    if (!ref) problems.push(`认不出内容元素 ${describeElement(el)}`)
    else if (entities.size && !el.matches('.QuestionHeader') && !entities.has(`${ref.type}:${ref.id}`)) {
      problems.push(`内容 ${ref.type}:${ref.id}（${describeElement(el)}）不在实体仓库里`)
    }
  }

  const expect = sample.expect ?? {}
  if (expect.contents !== undefined && contents.length !== expect.contents) {
    problems.push(`内容元素应有 ${expect.contents} 个，实际 ${contents.length} 个`)
  }
  if (expect.comments !== undefined) {
    const n = commentElements(entities).length
    if (n !== expect.comments) problems.push(`评论元素应有 ${expect.comments} 个，实际 ${n} 个`)
  }
  if (expect.columns) {
    const start = contents.find(el => !el.matches('.QuestionHeader'))
    if (!start || !findColumns(start)) problems.push('按位置找不到两栏布局的右侧栏')
  }
  return problems
}
