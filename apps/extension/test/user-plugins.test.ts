import { describe, expect, test } from 'vitest'
import { createManager, type InstallError, type ManagerDeps } from '../src/user-plugins/manager'
import { buildCode, type RegisteredScript, scriptId, type UserScriptsApi } from '../src/user-plugins/scripts'
import { readCode, readIndex, toIndex } from '../src/user-plugins/store'
import { fakeStorage } from './fake-storage'

const source = (extra = '', version = '1.0.0', id = 'my-plugin') => `
export const meta = {
  id: '${id}',
  name: '我的插件',
  version: '${version}',
  api: 1,${extra}
}
export default function (z) { z.log.info('hi') }
`

function fakeUserScripts() {
  const scripts = new Map<string, RegisteredScript>()
  const executed: { tabId: number; worldId?: string; code: string }[] = []
  const worlds: string[] = []
  const api: UserScriptsApi = {
    async register(list) {
      for (const s of list) {
        if (scripts.has(s.id)) throw new Error(`重复注册 ${s.id}`)
        scripts.set(s.id, s)
      }
    },
    async update(list) {
      for (const s of list) {
        if (!scripts.has(s.id)) throw new Error(`没有注册 ${s.id}`)
        scripts.set(s.id, s)
      }
    },
    async unregister(filter) {
      for (const id of filter?.ids ?? [...scripts.keys()]) scripts.delete(id)
    },
    async getScripts() {
      return [...scripts.keys()].map(id => ({ id }))
    },
    async configureWorld(p) {
      if (p.worldId) worlds.push(p.worldId)
    },
    async execute(injection) {
      executed.push({ tabId: injection.target.tabId, worldId: injection.worldId, code: injection.js[0]?.code ?? '' })
    },
  }
  return { api, scripts, executed, worlds }
}

function setup(options: { available?: boolean; tabs?: number[]; initial?: Record<string, unknown> } = {}) {
  const { api: storage, data, emit } = fakeStorage(options.initial)
  const us = fakeUserScripts()
  const writes: string[] = []
  const original = storage.local.set
  storage.local.set = async items => {
    writes.push(...Object.keys(items))
    return original(items)
  }
  let n = 0
  const deps: ManagerDeps = {
    storage,
    userScripts: async () => (options.available === false ? undefined : us.api),
    runtimeCode: async () => 'globalThis.__zbBoot = function(){}',
    zhihuTabs: async () => options.tabs ?? [],
    officialIds: ['filter', 'theme'],
    now: () => 1000 + n,
    secret: () => `secret${String(++n).padStart(20, '0')}`,
  }
  return { manager: createManager(deps), storage, data, emit, writes, ...us }
}

describe('安装', () => {
  test('解析、保存源码和脚本、注册用户脚本、最后写索引', async () => {
    const t = setup()
    const result = await t.manager.install(source(), 'my.ts')
    expect(result.plan.action).toBe('install')
    expect(result.scriptsAvailable).toBe(true)
    expect(result.entry).toMatchObject({ enabled: true, rev: 1 })

    const index = await readIndex(t.storage)
    expect(Object.keys(index)).toEqual(['my-plugin'])
    const stored = await readCode(t.storage, 'my-plugin')
    expect(stored?.source).toBe(source())
    expect(stored?.fileName).toBe('my.ts')
    expect(stored?.code).toMatch(/exports/)

    const script = t.scripts.get(scriptId('my-plugin'))
    expect(script).toMatchObject({
      world: 'USER_SCRIPT',
      worldId: 'zb-my-plugin',
      runAt: 'document_start',
      matches: ['*://*.zhihu.com/*'],
    })
    expect(script?.js[0]?.code).toContain(JSON.stringify(result.entry.secret))
    expect(t.worlds).toEqual(['zb-my-plugin'])
    // 代码就位之后才写索引
    expect(t.writes.indexOf('userCode:my-plugin')).toBeLessThan(t.writes.indexOf('userPlugins'))
  })

  test('已经打开的知乎页面里立即执行新代码', async () => {
    const t = setup({ tabs: [3, 5] })
    await t.manager.install(source())
    expect(t.executed.map(e => [e.tabId, e.worldId])).toEqual([
      [3, 'zb-my-plugin'],
      [5, 'zb-my-plugin'],
    ])
  })

  test('用户脚本不可用时仍然保存插件，并告知', async () => {
    const t = setup({ available: false })
    const result = await t.manager.install(source())
    expect(result.scriptsAvailable).toBe(false)
    expect(Object.keys(await readIndex(t.storage))).toEqual(['my-plugin'])
    expect(t.scripts.size).toBe(0)
  })

  test('不合法的插件不会留下任何东西', async () => {
    const t = setup()
    const error = (await t.manager.install('export default function () {}').catch(e => e)) as InstallError
    expect(error.name).toBe('InstallError')
    expect(error.problems.length).toBeGreaterThan(0)
    expect(t.data.size).toBe(0)
    expect(t.scripts.size).toBe(0)
  })

  test('不能和官方插件重名', async () => {
    const t = setup()
    await expect(t.manager.install(source('', '1.0.0', 'filter'))).rejects.toThrow('官方插件')
    expect(t.data.size).toBe(0)
  })

  test('plan 只检查不保存', async () => {
    const t = setup()
    const plan = await t.manager.plan(source("\n  permissions: ['net:api.example.com', 'net:*.cdn.com'],"))
    expect(plan.meta.id).toBe('my-plugin')
    expect(plan.hosts).toEqual(['*.cdn.com', 'api.example.com'])
    expect(plan.hostPatterns).toEqual(['*://*.cdn.com/*', '*://api.example.com/*'])
    expect(plan.action).toBe('install')
    expect(t.data.size).toBe(0)
  })
})

describe('更新', () => {
  test('沿用密钥和启用状态，rev 加一，权限变化被列出', async () => {
    const t = setup({ tabs: [1] })
    const first = await t.manager.install(source("\n  permissions: ['net:a.com'],"))
    await t.manager.setEnabled('my-plugin', false)
    const plan = await t.manager.plan(source("\n  permissions: ['net:a.com', 'net:b.com'],", '1.1.0'))
    expect(plan.action).toBe('update')
    expect(plan.permissions).toEqual({ added: ['b.com'], removed: [] })

    const second = await t.manager.install(source("\n  permissions: ['net:a.com', 'net:b.com'],", '1.1.0'))
    expect(second.entry.secret).toBe(first.entry.secret)
    expect(second.entry.enabled).toBe(false)
    expect(second.entry.rev).toBeGreaterThan(first.entry.rev)
    expect(second.entry.installedAt).toBe(first.entry.installedAt)
    expect(second.entry.meta.version).toBe('1.1.0')
  })

  test('版本号相同、更低时分别标出', async () => {
    const t = setup()
    await t.manager.install(source('', '2.0.0'))
    expect((await t.manager.plan(source('', '2.0.0'))).action).toBe('reinstall')
    expect((await t.manager.plan(source('', '1.0.0'))).action).toBe('downgrade')
  })

  test('更新时先换代码、再通知页面（热重载）', async () => {
    const t = setup({ tabs: [9] })
    await t.manager.install(source())
    t.executed.length = 0
    t.writes.length = 0
    await t.manager.install(source('', '1.0.1'))
    expect(t.executed).toHaveLength(1)
    expect(t.writes.at(-1)).toBe('userPlugins')
    expect(t.scripts.size).toBe(1)
  })
})

describe('启用、停用、卸载', () => {
  test('停用后撤销注册，启用后重新注册并执行到已打开的页面', async () => {
    const t = setup({ tabs: [4] })
    await t.manager.install(source())
    t.executed.length = 0
    await t.manager.setEnabled('my-plugin', false)
    expect((await readIndex(t.storage))['my-plugin']?.enabled).toBe(false)
    expect(t.scripts.size).toBe(0)

    await t.manager.setEnabled('my-plugin', true)
    expect(t.scripts.size).toBe(1)
    expect(t.executed.map(e => e.tabId)).toEqual([4])
  })

  test('卸载：删除索引、源码、设置和数据，撤销注册', async () => {
    const t = setup({ initial: { 'settings:other-one': { a: 1 }, 'data:other-one:k': 1 } })
    await t.manager.install(source())
    await t.storage.local.set({ 'settings:my-plugin': { a: 1 }, 'data:my-plugin:k': 1, 'data:my-plugin-2:k': 2 })
    await t.manager.uninstall('my-plugin')
    expect(await readIndex(t.storage)).toEqual({})
    expect([...t.data.keys()].sort()).toEqual([
      'data:my-plugin-2:k',
      'data:other-one:k',
      'settings:other-one',
      'userPlugins',
    ])
    expect(t.scripts.size).toBe(0)
  })

  test('启用一个没有安装的插件时报错', async () => {
    await expect(setup().manager.setEnabled('nope', true)).rejects.toThrow('没有安装')
  })

  test('操作依次执行，不会互相覆盖索引', async () => {
    const t = setup()
    await Promise.all([
      t.manager.install(source('', '1.0.0', 'plugin-a')),
      t.manager.install(source('', '1.0.0', 'plugin-b')),
      t.manager.install(source('', '1.0.0', 'plugin-c')),
    ])
    expect(Object.keys(await readIndex(t.storage)).sort()).toEqual(['plugin-a', 'plugin-b', 'plugin-c'])
    expect(t.scripts.size).toBe(3)
  })
})

describe('reconcile', () => {
  test('让注册的脚本和索引一致：补上缺的，撤销多的', async () => {
    const t = setup()
    await t.manager.install(source('', '1.0.0', 'plugin-a'))
    await t.manager.install(source('', '1.0.0', 'plugin-b'))
    await t.manager.setEnabled('plugin-b', false)
    t.scripts.clear()
    t.scripts.set('zb-gone', { id: 'zb-gone' } as RegisteredScript)

    const result = await t.manager.reconcile()
    expect(result).toMatchObject({ registered: ['plugin-a'], removed: ['gone'], available: true })
    expect([...t.scripts.keys()]).toEqual(['zb-plugin-a'])
    // 再来一次：已经一致，改成更新
    await t.manager.reconcile()
    expect([...t.scripts.keys()]).toEqual(['zb-plugin-a'])
  })

  test('用户脚本不可用时什么也不做', async () => {
    const t = setup({ available: false })
    expect(await t.manager.reconcile()).toMatchObject({ available: false })
  })
})

describe('索引的解析', () => {
  test('丢弃坏掉的条目', () => {
    const good = {
      meta: { id: 'a', name: 'a', version: '1.0.0', api: 1 },
      secret: 'x'.repeat(32),
      enabled: true,
      installedAt: 1,
      updatedAt: 2,
      rev: 3,
    }
    const index = toIndex({
      a: good,
      b: { ...good, meta: { ...good.meta, id: 'b' }, secret: 'short' },
      c: { ...good, meta: { ...good.meta, id: 'other' } },
      d: 'junk',
    })
    expect(Object.keys(index)).toEqual(['a'])
    expect(toIndex(null)).toEqual({})
  })
})

describe('buildCode', () => {
  test('运行时、密钥和插件代码拼在一起，能被执行', () => {
    const calls: unknown[] = []
    const code = buildCode(
      `globalThis.__zbBoot = function (channel, factory) { var exports = {}; factory(exports); __calls.push([channel, exports.value]) }`,
      'sec"ret',
      'exports.value = 42',
    )
    new Function('__calls', code)(calls)
    expect(calls).toEqual([['sec"ret', 42]])
    delete (globalThis as { __zbBoot?: unknown }).__zbBoot
  })
})
