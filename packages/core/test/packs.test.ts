import type { PluginMeta } from '@zhihu-browser/sdk'
import { describe, expect, test } from 'vitest'
import { createDataPack, parseDataPack, previewDataPack } from '../src/index'

const meta = {
  id: 'filter',
  name: '屏蔽',
  version: '1.0.0',
  api: 1,
  settings: {
    keywords: { type: 'list', label: '关键词', default: [] },
    mode: { type: 'select', label: '方式', default: 'fold', options: { fold: '折叠', remove: '去掉' } },
    hideAds: { type: 'boolean', label: '广告', default: true },
  },
} satisfies PluginMeta

const pack = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  zbPack: 1,
  plugin: 'filter',
  name: '示例',
  settings,
  ...extra,
})

describe('parseDataPack', () => {
  test('解析 JSON 字符串和对象', () => {
    const text = JSON.stringify(pack({ keywords: ['a'] }, { version: '1.2.0', description: '说明', extra: 1 }))
    expect(parseDataPack(text)).toEqual({
      pack: {
        zbPack: 1,
        plugin: 'filter',
        name: '示例',
        version: '1.2.0',
        description: '说明',
        settings: { keywords: ['a'] },
      },
      problems: [],
    })
    expect(parseDataPack(pack({})).pack?.name).toBe('示例')
  })

  test('格式不对时说明原因', () => {
    expect(parseDataPack('{').problems).toEqual(['不是有效的 JSON 文件'])
    expect(parseDataPack({ a: 1 }).problems).toEqual(['这不是 zhihu-browser 的数据包'])
    expect(parseDataPack(pack({}, { zbPack: 2 })).problems[0]).toContain('不支持的数据包版本')
    expect(parseDataPack(pack({}, { plugin: 'Bad Id', name: '' })).problems).toHaveLength(2)
    expect(parseDataPack(pack([] as never)).problems).toEqual(['settings 必须是对象'])
    expect(parseDataPack(pack({}, { author: 1 })).pack).toBeUndefined()
  })
})

describe('previewDataPack', () => {
  test('列表合并（去重、保留原顺序），其他设置覆盖，没变化的不列出', () => {
    const current = { keywords: ['旧', '重复'], mode: 'fold', hideAds: true }
    const parsed = parseDataPack(pack({ keywords: ['重复', '新', '新'], mode: 'remove', hideAds: true })).pack
    if (!parsed) throw new Error('解析失败')
    const preview = previewDataPack(parsed, meta, current)
    expect(preview.next).toEqual({ keywords: ['旧', '重复', '新'], mode: 'remove', hideAds: true })
    expect(preview.changes).toEqual([
      {
        key: 'keywords',
        label: '关键词',
        mode: 'merge',
        before: ['旧', '重复'],
        after: ['旧', '重复', '新'],
        added: ['新'],
      },
      { key: 'mode', label: '方式', mode: 'replace', before: 'fold', after: 'remove' },
    ])
    expect(preview.problems).toEqual([])
  })

  test('不认识的设置项、不合法的值被忽略；插件对不上时不改任何东西', () => {
    const parsed = parseDataPack(pack({ unknown: 1, mode: 'boom', hideAds: false })).pack
    if (!parsed) throw new Error('解析失败')
    const preview = previewDataPack(parsed, meta, {})
    expect(preview.changes.map(c => c.key)).toEqual(['hideAds'])
    expect(preview.problems).toEqual(['插件没有设置项 unknown，已忽略', '方式：值必须是 fold、remove 之一，已忽略'])
    const wrong = previewDataPack({ ...parsed, plugin: 'theme' }, meta, {})
    expect(wrong.changes).toEqual([])
    expect(wrong.problems[0]).toContain('theme')
  })
})

test('createDataPack 只导出和默认值不同的设置项，导出的数据包可以再导入', () => {
  const exported = createDataPack(
    meta,
    { keywords: ['a'], mode: 'fold', hideAds: false, junk: 1 },
    { name: '我的屏蔽列表' },
  )
  expect(exported).toEqual({
    zbPack: 1,
    plugin: 'filter',
    name: '我的屏蔽列表',
    version: '1.0.0',
    settings: { keywords: ['a'], hideAds: false },
  })
  const parsed = parseDataPack(JSON.stringify(exported)).pack
  if (!parsed) throw new Error('解析失败')
  expect(previewDataPack(parsed, meta, {}).next).toEqual({ keywords: ['a'], mode: 'fold', hideAds: false })
})
