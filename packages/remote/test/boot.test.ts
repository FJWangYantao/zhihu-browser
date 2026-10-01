import { createHost, createMemorySettingsBackend, createMemoryStorageBackend } from '@zhihu-browser/core'
import type { PluginMeta } from '@zhihu-browser/sdk'
import { describe, expect, test, vi } from 'vitest'
import { boot, domElementSharer, domTransport, remotePlugin } from '../src/index'
import { feedItem } from './helpers'

const meta: PluginMeta = { id: 'booted', name: 'booted', version: '1.0.0', api: 1 }

function makeHost() {
  return createHost({
    services: {
      settings: createMemorySettingsBackend(),
      storage: createMemoryStorageBackend(),
      fetch: async () => ({
        status: 200,
        ok: true,
        headers: {},
        text: async () => '',
        json: async () => ({}) as never,
      }),
      ui: { toast() {}, confirm: async () => true, mount: () => () => {} },
      addStyle: () => () => {},
      contents: { all: () => [], current: () => undefined },
      log() {},
    },
  })
}

const proxy = (channel: string) =>
  remotePlugin({
    meta,
    transport: domTransport(document, channel, 'host'),
    elements: domElementSharer(channel),
    startTimeoutMs: 100,
  })

describe('boot', () => {
  test('插件文件顶层的代码在 start 时才执行', async () => {
    const top = vi.fn()
    boot('lazy-1', exports => {
      top()
      exports.default = () => {}
    })
    expect(top).not.toHaveBeenCalled()

    // 宿主没有启用这个插件（比如安全模式）：代码始终不会执行
    const host = makeHost()
    await host.load(proxy('lazy-1'), { enabled: false })
    expect(top).not.toHaveBeenCalled()

    await host.enable('booted')
    expect(top).toHaveBeenCalledTimes(1)
    // 停用再启用：文件重新执行一遍，状态是全新的
    host.disable('booted')
    await host.enable('booted')
    expect(top).toHaveBeenCalledTimes(2)
  })

  test('热重载：新代码执行时销毁旧的运行时，宿主按新代码运行', async () => {
    boot('reload-1', exports => {
      exports.default = (z: { filter(kind: 'feed', fn: () => boolean): void }) => z.filter('feed', () => false)
    })
    const host = makeHost()
    await host.load(proxy('reload-1'))
    expect(host.shouldKeep('feed', feedItem())).toBe(false)

    boot('reload-1', exports => {
      exports.default = (z: { filter(kind: 'feed', fn: () => boolean): void }) => z.filter('feed', () => true)
    })
    host.disable('booted')
    await host.enable('booted')
    expect(host.shouldKeep('feed', feedItem())).toBe(true)
  })

  test('旧的运行时被销毁后不再响应，不会和新的重复处理', async () => {
    const calls: string[] = []
    boot('reload-2', exports => {
      exports.default = (z: { filter(kind: 'feed', fn: () => boolean): void }) =>
        z.filter('feed', () => {
          calls.push('old')
          return true
        })
    })
    boot('reload-2', exports => {
      exports.default = (z: { filter(kind: 'feed', fn: () => boolean): void }) =>
        z.filter('feed', () => {
          calls.push('new')
          return true
        })
    })
    const host = makeHost()
    await host.load(proxy('reload-2'))
    host.shouldKeep('feed', feedItem())
    expect(calls).toEqual(['new'])
  })
})
