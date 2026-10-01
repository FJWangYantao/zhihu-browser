import { createHost, createMemorySettingsBackend, createMemoryStorageBackend, type Host } from '@zhihu-browser/core'
import { boot } from '@zhihu-browser/remote'
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'
import { afterEach, describe, expect, test } from 'vitest'
import { connectUserPlugins, type UserPluginConnection } from '../src/user-plugins/content'
import { USER_PLUGINS_KEY, type UserPluginEntry } from '../src/user-plugins/store'
import { fakeStorage } from './fake-storage'

const flush = () => new Promise(resolve => setTimeout(resolve, 10))

const feedItem = { id: 'f', kind: 'content' as const }

function makeHost(): Host {
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

let secretCounter = 0
const entry = (id: string, overrides: Partial<UserPluginEntry> = {}): UserPluginEntry => ({
  meta: { id, name: id, version: '1.0.0', api: 1 } as PluginMeta,
  secret: `secret-${id}-${++secretCounter}`.padEnd(24, 'x'),
  enabled: true,
  installedAt: 0,
  updatedAt: 0,
  rev: 1,
  ...overrides,
})

/** 在"用户脚本环境"里启动插件（测试里和代理在同一个文档中，用同样的通道） */
const run = (e: UserPluginEntry, entryFn: (z: PluginAPI) => unknown) =>
  boot(e.secret, exports => {
    exports.default = entryFn
  })

let connection: UserPluginConnection | undefined
afterEach(() => {
  connection?.stop()
  connection = undefined
})

describe('connectUserPlugins', () => {
  test('按索引加载插件，已启用的开始运行', async () => {
    const a = entry('plugin-a')
    run(a, z => z.filter('feed', () => false))
    const { api } = fakeStorage({ [USER_PLUGINS_KEY]: { 'plugin-a': a } })
    const host = makeHost()
    connection = connectUserPlugins({ host, api, doc: document })
    await connection.ready
    expect(host.plugin('plugin-a')?.state).toBe('active')
    expect(host.shouldKeep('feed', feedItem)).toBe(false)
  })

  test('没有启用的插件只登记，不运行', async () => {
    const a = entry('plugin-b', { enabled: false })
    let started = false
    run(a, () => {
      started = true
    })
    const { api } = fakeStorage({ [USER_PLUGINS_KEY]: { 'plugin-b': a } })
    const host = makeHost()
    connection = connectUserPlugins({ host, api, doc: document })
    await connection.ready
    expect(host.plugin('plugin-b')).toMatchObject({ state: 'inactive', enabled: false })
    expect(started).toBe(false)
  })

  test('索引变化：新增、更新（rev 变）、停用、删除，都立即反映', async () => {
    const { api } = fakeStorage()
    const host = makeHost()
    connection = connectUserPlugins({ host, api, doc: document })
    await connection.ready
    expect(host.plugins()).toEqual([])

    const a = entry('plugin-c')
    run(a, z => z.filter('feed', () => false))
    await api.local.set({ [USER_PLUGINS_KEY]: { 'plugin-c': a } })
    await flush()
    expect(host.shouldKeep('feed', feedItem)).toBe(false)

    // 更新：新代码就位后 rev 加一
    run(a, z => z.filter('feed', () => true))
    await api.local.set({ [USER_PLUGINS_KEY]: { 'plugin-c': { ...a, rev: 2 } } })
    await flush()
    expect(host.shouldKeep('feed', feedItem)).toBe(true)

    await api.local.set({ [USER_PLUGINS_KEY]: { 'plugin-c': { ...a, rev: 3, enabled: false } } })
    await flush()
    expect(host.plugin('plugin-c')?.state).toBe('inactive')

    await api.local.set({ [USER_PLUGINS_KEY]: {} })
    await flush()
    expect(host.plugin('plugin-c')).toBeUndefined()
  })

  test('运行时不在线：插件出错停用；运行时晚点出现时自动重试', async () => {
    const a = entry('plugin-d')
    const { api } = fakeStorage({ [USER_PLUGINS_KEY]: { 'plugin-d': a } })
    const host = makeHost()
    const promise = connectUserPlugins({ host, api, doc: document })
    connection = promise
    await promise.ready
    expect(host.plugin('plugin-d')).toMatchObject({ state: 'failed' })
    expect(host.plugin('plugin-d')?.reason).toContain('允许用户脚本')

    // 用户打开了开关，脚本被执行到页面里
    run(a, z => z.filter('feed', () => false))
    await flush()
    expect(host.plugin('plugin-d')?.state).toBe('active')
    expect(host.shouldKeep('feed', feedItem)).toBe(false)
  }, 15_000)

  test('一个插件没有响应，不影响别的插件', async () => {
    const good = entry('plugin-e')
    const dead = entry('plugin-f')
    run(good, z => z.filter('feed', () => false))
    const { api } = fakeStorage({ [USER_PLUGINS_KEY]: { 'plugin-e': good, 'plugin-f': dead } })
    const host = makeHost()
    connection = connectUserPlugins({ host, api, doc: document })
    await connection.ready
    expect(host.plugin('plugin-e')?.state).toBe('active')
    expect(host.plugin('plugin-f')?.state).toBe('failed')
  }, 15_000)

  test('stop 之后卸载全部', async () => {
    const a = entry('plugin-g')
    run(a, () => {})
    const { api } = fakeStorage({ [USER_PLUGINS_KEY]: { 'plugin-g': a } })
    const host = makeHost()
    const c = connectUserPlugins({ host, api, doc: document })
    await c.ready
    c.stop()
    expect(host.plugins()).toEqual([])
  })
})
