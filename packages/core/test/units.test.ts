import type { PluginMeta } from '@zhihu-browser/sdk'
import { describe, expect, test } from 'vitest'
import {
  checkFetchUrl,
  formatShortcut,
  hostMatches,
  normalizeShortcut,
  resolveMod,
  sanitizeSettings,
  validateMeta,
  validPermission,
} from '../src/index'

describe('validateMeta', () => {
  const ok = { id: 'long-answer-fold', name: '长文折叠', version: '1.0.0', api: 1 }

  test('合法的 meta 没有问题', () => {
    expect(validateMeta(ok)).toEqual([])
    expect(validateMeta({ ...ok, version: '1.0.0-beta.1', permissions: ['net:api.example.com'] })).toEqual([])
  })

  test('逐项报告问题', () => {
    expect(validateMeta(null)).toEqual(['meta 必须是对象'])
    expect(validateMeta({ ...ok, id: 'Long_Answer' })[0]).toContain('id')
    expect(validateMeta({ ...ok, api: 2 })[0]).toContain('不受支持')
    expect(validateMeta({ ...ok, permissions: ['api.example.com'] })[0]).toContain('net:域名')
    expect(validateMeta({ ...ok, permissions: ['net:www.zhihu.com'] })[0]).toContain('net:域名')
  })

  test('检查设置项的定义和默认值', () => {
    const settings = (spec: unknown) => validateMeta({ ...ok, settings: { x: spec } })
    expect(settings({ type: 'number', label: '数', default: 5, min: 10 })[0]).toContain('默认值不能小于 10')
    expect(settings({ type: 'select', label: '选', default: 'c', options: { a: 'A' } })[0]).toContain('a 之一')
    expect(settings({ type: 'list', label: '列表', default: [1] })[0]).toContain('字符串数组')
    expect(settings({ type: 'date', label: '日期', default: '' })[0]).toContain('不支持的类型')
    expect(settings({ type: 'boolean', default: true })[0]).toContain('label')
  })
})

test('sanitizeSettings：未知的键丢弃，不合法的值换成默认值', () => {
  const meta = {
    id: 'a',
    name: 'a',
    version: '1.0.0',
    api: 1,
    settings: {
      on: { type: 'boolean', label: '开', default: true },
      mode: { type: 'select', label: '模式', default: 'fold', options: { fold: '折叠', remove: '去掉' } },
    },
  } satisfies PluginMeta
  expect(sanitizeSettings(meta, { on: false, mode: 'boom', extra: 1 })).toEqual({
    values: { on: false, mode: 'fold' },
    invalid: ['mode'],
  })
})

describe('normalizeShortcut', () => {
  test.each([
    ['j', 'j'],
    ['Shift+J', 'shift+j'],
    ['shift+mod+Enter', 'mod+shift+enter'],
    ['g  g', 'g g'],
    ['Cmd+K', 'meta+k'],
    ['Esc', 'escape'],
    ['ctrl+alt+ArrowUp', 'ctrl+alt+up'],
    ['+', '+'],
    ['Ctrl++', 'ctrl++'],
    ['?', '?'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeShortcut(input)).toBe(expected)
  })

  test.each([[''], ['hyper+x'], ['shift+'], ['shift+pgup2']])('写法不对：%j', input => {
    expect(() => normalizeShortcut(input)).toThrow()
  })

  test('mod 按平台解析', () => {
    expect(resolveMod('mod+k', 'mac')).toBe('meta+k')
    expect(resolveMod('mod+shift+k g', 'other')).toBe('ctrl+shift+k g')
    expect(resolveMod('mod+ctrl+k', 'other')).toBe('ctrl+k')
    expect(resolveMod('shift+j', 'mac')).toBe('shift+j')
  })

  test('显示写法', () => {
    expect(formatShortcut('mod+shift+k', 'mac')).toBe('⌘⇧K')
    expect(formatShortcut('mod+shift+k', 'other')).toBe('Ctrl+Shift+K')
    expect(formatShortcut('g g', 'other')).toBe('G G')
    expect(formatShortcut('alt+up', 'mac')).toBe('⌥↑')
    expect(formatShortcut('escape', 'other')).toBe('Esc')
  })
})

describe('网络权限', () => {
  test('域名匹配与浏览器主机权限一致', () => {
    expect(hostMatches('api.example.com', 'api.example.com')).toBe(true)
    expect(hostMatches('api.example.com', 'x.api.example.com')).toBe(false)
    expect(hostMatches('*.example.com', 'example.com')).toBe(true)
    expect(hostMatches('*.example.com', 'a.b.example.com')).toBe(true)
    expect(hostMatches('*.example.com', 'badexample.com')).toBe(false)
  })

  test('权限写法', () => {
    expect(validPermission('net:api.example.com')).toBe(true)
    expect(validPermission('net:*.example.com')).toBe(true)
    expect(validPermission('net:localhost')).toBe(false)
    expect(validPermission('net:*.zhihu.com')).toBe(false)
    expect(validPermission('http:api.example.com')).toBe(false)
  })

  test('checkFetchUrl', () => {
    const meta = { id: 'a', name: 'a', version: '1.0.0', api: 1, permissions: ['net:api.example.com'] } as PluginMeta
    expect(checkFetchUrl(meta, 'https://api.example.com/x').hostname).toBe('api.example.com')
    expect(() => checkFetchUrl(meta, 'ftp://api.example.com/')).toThrow('http')
    expect(() => checkFetchUrl(meta, 'https://zhuanlan.zhihu.com/api')).toThrow('知乎')
  })
})
