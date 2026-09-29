// fixtures 测试：test/pages/*.json 里的每一份页面样本，都要让适配层正确识别。
// 真实页面的样本用命令面板的"采集页面样本"采集，见 docs/fixtures.md；知乎改版后重新采集，失败的样本就指出了要修的地方。

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { type PageSnapshot, SNAPSHOT_FORMAT } from '../src/snapshot'
import { flush, type Setup, setup } from './page'
import { checkSample, contentElements, loadSample } from './sample'

const dir = join(import.meta.dirname, 'pages')
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort()
  : []
const read = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as PageSnapshot

let s: Setup | undefined
afterEach(() => {
  s?.dispose()
  s = undefined
  document.body.replaceChildren()
  for (const a of [...document.documentElement.attributes]) document.documentElement.removeAttribute(a.name)
  window.happyDOM?.setURL('https://www.zhihu.com/')
})

test('至少有一份页面样本', () => {
  expect(files.length).toBeGreaterThan(0)
})

describe.each(files)('页面样本 %s', file => {
  test('格式、脱敏、锚点、内容识别、评论、布局', () => {
    const sample = read(file)
    expect(sample.format).toBe(SNAPSHOT_FORMAT)
    expect(checkSample(sample)).toEqual([])
  })

  test('适配层整体：识别每一块内容，健康检查通过，页面没有被误藏', async () => {
    const sample = read(file)
    window.happyDOM?.setURL(sample.url)
    s = await setup({ healthDelayMs: 10 })
    loadSample(sample)
    // 样本装进文档之后，适配层的 MutationObserver 才扫描到元素
    document.body.append(document.createElement('div'))
    await flush()
    await flush()

    const expected = contentElements().length
    expect(document.querySelectorAll('[data-zb-id]').length).toBe(expected)
    const health = s.adapter.health()
    expect(health.disabledFeatures).toEqual([])
    expect(health.anchors.filter(a => !a.healthy)).toEqual([])
    // 没有任何插件过滤时：没有内容被隐藏，预隐藏已经撤下
    expect(document.querySelectorAll('[data-zb-hidden]').length).toBe(0)
  })
})
