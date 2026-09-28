import { describe, expect, test } from 'vitest'
import {
  createSettingsBackend,
  createStorageBackend,
  isEnabled,
  readState,
  type StorageApi,
  toPluginStates,
} from '../src/storage'

/** 内存里的 chrome.storage：只实现用到的部分 */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(structuredClone(initial)))
  type Listener = Parameters<StorageApi['onChanged']['addListener']>[0]
  const listeners = new Set<Listener>()
  const emit = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area = 'local') => {
    for (const fn of listeners) fn(changes, area)
  }
  const api: StorageApi = {
    local: {
      async get(keys) {
        const list = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(list.filter(k => data.has(k)).map(k => [k, structuredClone(data.get(k))]))
      },
      async set(items) {
        const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {}
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: data.get(k), newValue: structuredClone(v) }
          data.set(k, structuredClone(v))
        }
        emit(changes)
      },
      async remove(keys) {
        const changes: Record<string, { oldValue?: unknown }> = {}
        for (const k of Array.isArray(keys) ? keys : [keys]) {
          changes[k] = { oldValue: data.get(k) }
          data.delete(k)
        }
        emit(changes)
      },
    },
    onChanged: {
      addListener: fn => listeners.add(fn),
      removeListener: fn => listeners.delete(fn),
    },
  }
  return { api, data, emit, listeners }
}

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
  expect(state).toEqual({ safeMode: true, plugins: { filter: { enabled: false } } })
  expect(isEnabled(state.plugins, 'filter')).toBe(false)
  // 没有记录的插件默认启用
  expect(isEnabled(state.plugins, 'theme')).toBe(true)
  expect(toPluginStates(null)).toEqual({})
  expect((await readState(fakeStorage().api)).safeMode).toBe(false)
})
