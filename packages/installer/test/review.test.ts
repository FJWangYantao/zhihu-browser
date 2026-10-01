import type { PluginMeta } from '@zhihu-browser/sdk'
import { describe, expect, test } from 'vitest'
import { compareVersions, diffPermissions, hostPermissionPattern, networkHosts } from '../src/index'

const meta = (permissions?: PluginMeta['permissions']): PluginMeta => ({
  id: 'a',
  name: 'a',
  version: '1.0.0',
  api: 1,
  ...(permissions ? { permissions } : {}),
})

describe('权限变化', () => {
  test('列出域名', () => {
    expect(networkHosts(meta(['net:b.example.com', 'net:*.a.com']))).toEqual(['*.a.com', 'b.example.com'])
    expect(networkHosts(meta())).toEqual([])
  })

  test('更新时只有新增的权限需要重新确认', () => {
    expect(diffPermissions(meta(['net:a.com']), meta(['net:a.com', 'net:b.com']))).toEqual({
      added: ['b.com'],
      removed: [],
    })
    expect(diffPermissions(meta(['net:a.com', 'net:b.com']), meta(['net:a.com']))).toEqual({
      added: [],
      removed: ['b.com'],
    })
    expect(diffPermissions(undefined, meta(['net:a.com']))).toEqual({ added: ['a.com'], removed: [] })
  })

  test('转成浏览器的主机权限', () => {
    expect(hostPermissionPattern('*.example.com')).toBe('*://*.example.com/*')
    expect(hostPermissionPattern('api.example.com')).toBe('*://api.example.com/*')
  })
})

describe('版本比较', () => {
  test.each([
    ['1.0.1', '1.0.0', 1],
    ['1.10.0', '1.9.9', 1],
    ['2.0.0', '10.0.0', -1],
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.0-beta', 1],
    ['1.0.0-alpha', '1.0.0-beta', -1],
  ])('%s 对 %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign)
  })
})
