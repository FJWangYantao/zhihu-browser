// 锚点健康检查：每个锚点声明它在某类页面上应匹配到多少个元素。
// 运行时不满足时停用依赖它的功能，并在页面角落提示"知乎页面结构可能已变化"（见 dom/health-notice.ts）。
// 声明要保守：误报会停用正常的功能。宁可少声明，等真实页面核对过之后再加。

import type { PageInfo, PageType } from '@zhihu-browser/sdk'

/** 依赖锚点的功能；失配时按 plan.md 5.4"自动停用依赖它的功能" */
export type FeatureId = 'contents' | 'item-ui'

/** 功能的中文名，提示和诊断里用 */
export const FEATURE_NAMES: Record<FeatureId, string> = {
  contents: '内容识别',
  'item-ui': '内容上的界面',
}

export interface AnchorExpect {
  /** 至少命中几个，默认 1 */
  min?: number
  /** 至多命中几个，默认不限；min 和 max 相同时表示"应该恰好这么多个" */
  max?: number
}

/** 一个锚点的声明：选择器、在哪类页面上应命中多少、依赖它的功能 */
export interface AnchorSpec {
  selector: string
  /** 检查时机：contents = 识别到内容之后；hydrated = 知乎前端激活之后（这时操作栏等界面才出现） */
  when: HealthStage
  /** 各页面类型上的期望命中数；没声明的页面类型不检查 */
  pages: Partial<Record<PageType, AnchorExpect>>
  /** 依赖这个锚点的功能；失配时停用 */
  features: FeatureId[]
}

/**
 * 锚点声明。注意：
 * - 首页、关注页右侧栏的类名已经变过（M1 实测），改为按位置找（dom/layout.ts），不声明：
 *   类名锚点失配不等于功能坏了（按位置还能找到），声明了会误报；
 * - 搜索页可能没有结果、想法卡片可能没有标题，这类"合法的零"不声明；
 * - "阅读全文"（.ContentItem-more）只在有折叠内容时出现，不声明。
 */
export const ANCHOR_SPECS: readonly AnchorSpec[] = [
  {
    selector: '.ContentItem, .HotItem, .QuestionHeader, [data-zop]',
    when: 'contents',
    pages: { home: {}, follow: {}, hot: {}, question: {}, answer: {}, article: {}, people: {} },
    features: ['contents'],
  },
  {
    selector: '.ContentItem-title, .HotItem-title, .QuestionHeader-title, .Post-Title',
    when: 'contents',
    pages: { home: {}, follow: {}, hot: {}, question: {}, article: {} },
    features: ['item-ui'],
  },
]

export type HealthStage = 'contents' | 'hydrated'

/** 一个锚点的检查结果 */
export interface AnchorHealth {
  selector: string
  matched: number
  /** 期望的写法，如 "≥1"、"=1"、"1–2"，诊断里显示用 */
  expected: string
  healthy: boolean
}

export interface HealthReport {
  stage: HealthStage
  page: PageType
  anchors: AnchorHealth[]
  /** 这次检查里失配的功能 */
  failedFeatures: FeatureId[]
}

/** 两个时机的检查合在一起：当前页面的健康情况，诊断和适配层的 health() 用 */
export interface HealthSummary {
  page: PageType
  anchors: AnchorHealth[]
  /** 被停用的功能 */
  disabledFeatures: FeatureId[]
}

function expectedText(expect: AnchorExpect): string {
  const min = expect.min ?? 1
  const max = expect.max
  if (max === undefined) return `≥${min}`
  if (min === max) return `=${min}`
  return `${min}–${max}`
}

function healthy(matched: number, expect: AnchorExpect): boolean {
  const min = expect.min ?? 1
  if (matched < min) return false
  return expect.max === undefined || matched <= expect.max
}

/**
 * 检查当前页面的锚点。返回这次检查的报告；当前页面类型没有任何声明（或该时机没有声明）时返回 undefined。
 * specs 参数默认是 ANCHOR_SPECS，测试时可以传入自己的声明。
 */
export function checkAnchors(
  doc: Document,
  page: PageInfo,
  stage: HealthStage,
  specs: readonly AnchorSpec[] = ANCHOR_SPECS,
): HealthReport | undefined {
  const anchors: AnchorHealth[] = []
  const failed = new Set<FeatureId>()
  for (const spec of specs) {
    const expect = spec.pages[page.type]
    if (!expect || spec.when !== stage) continue
    const matched = doc.querySelectorAll(spec.selector).length
    const ok = healthy(matched, expect)
    anchors.push({ selector: spec.selector, matched, expected: expectedText(expect), healthy: ok })
    if (!ok) for (const f of spec.features) failed.add(f)
  }
  if (!anchors.length) return undefined
  return { stage, page: page.type, anchors, failedFeatures: [...failed] }
}
