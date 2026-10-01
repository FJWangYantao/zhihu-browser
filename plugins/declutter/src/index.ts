// 官方插件"去干扰"：隐藏横幅广告、推广卡片、创作者中心入口，去掉信息流里的推广和广告。
// 样式规则只用知乎页面上有语义的类名（Banner、Pc-card、CreatorEntrance 等），不用 css-xxxxxx 这类自动生成的类名；
// 这些类名都是在真实页面样本里确认过的（见 test/real-pages.test.ts）。
//
// 直接针对知乎选择器的样式属于 unstable：知乎改版后选择器失效时，这个插件的规则要跟着改。

import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'declutter',
  name: '去干扰',
  version: '0.1.0',
  api: 1,
  description: '隐藏横幅广告、推广卡片、创作者中心入口，去掉信息流里的推广和广告',
  settings: {
    banners: {
      type: 'boolean',
      label: '隐藏横幅广告',
      default: true,
      description: '首页顶部横幅、右侧栏和问题页侧栏里的广告图',
    },
    promoCards: {
      type: 'boolean',
      label: '隐藏推广卡片',
      default: true,
      description: '回答和文章中间插入的推广卡片、盐选推广、热词卡片',
    },
    creator: { type: 'boolean', label: '隐藏创作者中心入口', default: true, description: '右侧栏的"创作者中心"' },
    feedPromotions: {
      type: 'boolean',
      label: '去掉信息流里的推广和活动',
      default: true,
      description: '在知乎渲染之前去掉，不会出现空位',
    },
    feedAds: { type: 'boolean', label: '去掉信息流里的广告', default: true },
    custom: {
      type: 'list',
      label: '自定义要隐藏的元素',
      default: [],
      placeholder: '如：.Footer',
      description: '每行一个 CSS 选择器。不能包含 { } ; @ 等字符，写错的会被忽略。',
    },
  },
} satisfies PluginMeta

/** 每一类干扰对应的选择器。:has() 用来隐藏只有一层包装的卡片整体，而不只是里面的链接。 */
export const SELECTORS = {
  banners: [
    '.Pc-Business-Card-PcTopFeedBanner',
    '.Question-sideColumnAdContainer',
    '.Card:has(> .Business-Card-PcRightBanner-link)',
    '.Card:has(> .Banner-link)',
  ],
  promoCards: [
    '.pc-article-answer',
    '.pc-article-answer-big-img',
    '.Pc-word-new',
    '.Card:has(> .KfeCollection-CreateSaltCard)',
  ],
  creator: ['.CreatorEntrance'],
} as const

export interface DeclutterOptions {
  banners: boolean
  promoCards: boolean
  creator: boolean
  custom: string[]
}

/** 自定义选择器只允许"选择元素"本身，不允许借机写任意 CSS */
export function isSafeSelector(selector: string): boolean {
  const s = selector.trim()
  return s.length > 0 && s.length <= 200 && !/[{};@\\<]|\/\*|\*\/|url\(|expression\(/i.test(s)
}

export function cssFor(options: DeclutterOptions): string {
  const selectors: string[] = []
  if (options.banners) selectors.push(...SELECTORS.banners)
  if (options.promoCards) selectors.push(...SELECTORS.promoCards)
  if (options.creator) selectors.push(...SELECTORS.creator)
  selectors.push(...options.custom.filter(isSafeSelector).map(s => s.trim()))
  if (!selectors.length) return ''
  // 一条规则一个选择器：其中一个写错（浏览器不认识）时，不会连累别的规则
  return selectors.map(s => `${s} { display: none !important; }`).join('\n')
}

export default function declutter(z: PluginAPI<typeof meta>) {
  let remove: (() => void) | undefined

  const apply = () => {
    remove?.()
    const css = cssFor({
      banners: z.settings.get('banners'),
      promoCards: z.settings.get('promoCards'),
      creator: z.settings.get('creator'),
      custom: z.settings.get('custom'),
    })
    remove = css ? z.addStyle(css) : undefined
  }
  apply()
  z.settings.onChange(apply)

  // 信息流在渲染之前去掉：广告是 ad，推广和活动是 promotion
  z.filter('feed', item => {
    if (item.kind === 'ad') return !z.settings.get('feedAds')
    if (item.kind === 'promotion') return !z.settings.get('feedPromotions')
    return true
  })
}
