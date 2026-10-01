import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHost, createMemorySettingsBackend, createMemoryStorageBackend } from '@zhihu-browser/core'
import type { FeedItem } from '@zhihu-browser/sdk'
import { describe, expect, test } from 'vitest'
import * as plugin from '../src/index'
import { cssFor, isSafeSelector, SELECTORS } from '../src/index'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function setup(settings: Record<string, unknown> = {}) {
  const styles = new Set<string>()
  const backend = createMemorySettingsBackend({ declutter: settings })
  const host = createHost({
    services: {
      settings: backend,
      storage: createMemoryStorageBackend(),
      fetch: async () => ({
        status: 200,
        ok: true,
        headers: {},
        text: async () => '',
        json: async () => ({}) as never,
      }),
      ui: { toast() {}, confirm: async () => true, mount: () => () => {} },
      addStyle(css) {
        styles.add(css)
        return () => styles.delete(css)
      },
      contents: { all: () => [], current: () => undefined },
      log() {},
    },
  })
  return { host, styles, backend }
}

const item = (kind: FeedItem['kind']): FeedItem => ({ id: `${kind}-1`, kind })

describe('样式', () => {
  test('默认隐藏横幅、推广卡片和创作者中心，每条规则独立', () => {
    const css = cssFor({ banners: true, promoCards: true, creator: true, custom: [] })
    for (const selector of [...SELECTORS.banners, ...SELECTORS.promoCards, ...SELECTORS.creator]) {
      expect(css).toContain(`${selector} { display: none !important; }`)
    }
  })

  test('只打开某一类', () => {
    const css = cssFor({ banners: false, promoCards: false, creator: true, custom: [] })
    expect(css).toBe('.CreatorEntrance { display: none !important; }')
    expect(cssFor({ banners: false, promoCards: false, creator: false, custom: [] })).toBe('')
  })

  test('自定义选择器：安全的保留，想夹带别的 CSS 的丢弃', () => {
    const css = cssFor({
      banners: false,
      promoCards: false,
      creator: false,
      custom: [' .Footer ', 'a { color: red }', '.x; .y', '@import "x"', '', 'div[data-a="b"]', '.a\\62', '/* x */ .b'],
    })
    expect(css).toBe('.Footer { display: none !important; }\ndiv[data-a="b"] { display: none !important; }')
    expect(isSafeSelector('.a > .b:not(.c)')).toBe(true)
    expect(isSafeSelector('x'.repeat(201))).toBe(false)
  })
})

describe('插件', () => {
  test('启动时注入样式，设置变化后更新，停用后撤销', async () => {
    const { host, styles, backend } = setup()
    await host.load(plugin as never)
    expect(styles.size).toBe(1)
    expect([...styles][0]).toContain('.CreatorEntrance')
    backend.update('declutter', { creator: false, custom: ['.Foo'] })
    await flush()
    expect(styles.size).toBe(1)
    expect([...styles][0]).not.toContain('.CreatorEntrance')
    expect([...styles][0]).toContain('.Foo')
    host.disable('declutter')
    expect(styles.size).toBe(0)
  })

  test('信息流里的广告和推广在渲染之前去掉，普通内容保留', async () => {
    const { host } = setup()
    await host.load(plugin as never)
    expect(host.shouldKeep('feed', item('ad'))).toBe(false)
    expect(host.shouldKeep('feed', item('promotion'))).toBe(false)
    expect(host.shouldKeep('feed', item('content'))).toBe(true)
    expect(host.shouldKeep('feed', item('other'))).toBe(true)
  })

  test('可以单独保留广告或推广', async () => {
    const { host } = setup({ feedAds: false, feedPromotions: true })
    await host.load(plugin as never)
    expect(host.shouldKeep('feed', item('ad'))).toBe(true)
    expect(host.shouldKeep('feed', item('promotion'))).toBe(false)
  })
})

// 选择器必须是在真实知乎页面上确认过的：用采集到的脱敏页面样本核对
describe('真实页面样本', () => {
  const dir = resolve(import.meta.dirname, '../../../packages/adapter-zhihu/test/pages')
  const real = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('synthetic-'))
  const classesIn = (file: string) => {
    const sample = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as { html: string[] }
    const classes = new Set<string>()
    for (const tag of sample.html)
      for (const m of tag.matchAll(/class="([^"]*)"/g)) for (const c of (m[1] ?? '').split(/\s+/)) classes.add(c)
    return classes
  }
  const all = new Set(real.flatMap(f => [...classesIn(f)]))

  test('样本是真实页面', () => {
    expect(real.length).toBeGreaterThanOrEqual(9)
  })

  test.each([
    ['横幅：首页顶部', 'Pc-Business-Card-PcTopFeedBanner'],
    ['横幅：问题页侧栏', 'Question-sideColumnAdContainer'],
    ['横幅：右侧栏', 'Business-Card-PcRightBanner-link'],
    ['横幅：问题页卡片', 'Banner-link'],
    ['推广卡片：回答', 'pc-article-answer'],
    ['推广卡片：大图', 'pc-article-answer-big-img'],
    ['推广卡片：热词', 'Pc-word-new'],
    ['推广卡片：盐选', 'KfeCollection-CreateSaltCard'],
    ['创作者中心', 'CreatorEntrance'],
  ])('%s 的类名 %s 在真实页面里出现过', (_name, cls) => {
    expect(all.has(cls)).toBe(true)
  })
})
