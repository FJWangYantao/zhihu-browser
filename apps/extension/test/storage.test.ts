import { describe, expect, test } from 'vitest'
import {
  createSettingsBackend,
  createStorageBackend,
  isEnabled,
  readState,
  saveRegistry,
  toKeymap,
  toPluginStates,
  toRegistry,
} from '../src/storage'
import { fakeStorage } from './fake-storage'

describe('设置', () => {
  test('按插件 id 读写', async () => {
    const { api, data } = fakeStorage({ 'settings:filter': { mode: 'remove' } })
    const backend = createSettingsBackend(api)
    expect(await backend.load('filter')).toEqual({ mode: 'remove' })
    expect(await backend.load('other')).toEqual({})
    await backend.save('other', { a: 1 })
    expect(data.get('settings:other')).toEqual({ a: 1 })
  })

  test('存的不是对象时按空设置处理', async () => {
    const { api } = fakeStorage({ 'settings:filter': ['x'] })
    expect(await createSettingsBackend(api).load('filter')).toEqual({})
  })

  test('只通知对应插件的变化；删除（恢复默认）时收到空对象；可以取消订阅', async () => {
    const { api, emit, listeners } = fakeStorage()
    const backend = createSettingsBackend(api)
    const seen: unknown[] = []
    const unsubscribe = backend.subscribe('filter', values => seen.push(values))
    await api.local.set({ 'settings:other': { a: 1 }, 'settings:filter': { mode: 'fold' } })
    await api.local.remove('settings:filter')
    emit({ 'settings:filter': { newValue: { mode: 'remove' } } }, 'sync')
    expect(seen).toEqual([{ mode: 'fold' }, {}])
    unsubscribe()
    expect(listeners.size).toBe(0)
  })
})

test('插件存储：按插件隔离，keys 只列出自己的', async () => {
  const { api, data } = fakeStorage({ 'data:b:x': 1, 'settings:a': {} })
  const storage = createStorageBackend(api)
  await storage.set('a', 'seen', [1, 2])
  await storage.set('a', 'x:y', 'v')
  expect(await storage.get('a', 'seen')).toEqual([1, 2])
  expect(await storage.get('a', 'missing')).toBeUndefined()
  expect((await storage.keys('a')).sort()).toEqual(['seen', 'x:y'])
  await storage.delete('a', 'seen')
  expect(data.has('data:a:seen')).toBe(false)
  expect(await storage.keys('b')).toEqual(['x'])
})

test('启用状态和安全模式', async () => {
  const { api } = fakeStorage({ safeMode: true, plugins: { filter: { enabled: false }, bad: { enabled: 'yes' } } })
  const state = await readState(api)
  expect(state).toEqual({ safeMode: true, plugins: { filter: { enabled: false } }, keymap: {} })
  expect(isEnabled(state.plugins, 'filter')).toBe(false)
  // 没有记录的插件默认启用
  expect(isEnabled(state.plugins, 'theme')).toBe(true)
  expect(toPluginStates(null)).toEqual({})
  expect((await readState(fakeStorage().api)).safeMode).toBe(false)
})

test('快捷键：改键表和命令面板的快捷键', async () => {
  const { api } = fakeStorage({ keymap: { 'nav:j': 'n', 'nav:k': 1 }, paletteKeys: '' })
  const state = await readState(api)
  expect(state.keymap).toEqual({ 'nav:j': 'n' })
  expect(state.paletteKeys).toBe('')
  expect(toKeymap(['x'])).toEqual({})
  expect((await readState(fakeStorage().api)).paletteKeys).toBeUndefined()
})

test('登记的快捷键：只在有变化时写入', async () => {
  const { api, writes } = fakeStorage()
  const registry = {
    platform: 'other' as const,
    shortcuts: [{ id: 'nav:j', keys: 'j', defaultKeys: 'j', pluginId: 'nav', description: '下一条' }],
  }
  expect(await saveRegistry(api, registry)).toBe(true)
  expect(await saveRegistry(api, structuredClone(registry))).toBe(false)
  expect(writes).toHaveLength(1)
  expect(toRegistry((await api.local.get('registry')).registry)).toEqual(registry)
  expect(toRegistry({ platform: 'linux', shortcuts: [] })).toBeUndefined()
  expect(toRegistry(null)).toBeUndefined()
})
