import type { StorageApi } from '../src/storage'

/** 内存里的 chrome.storage：只实现用到的部分 */
export function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(structuredClone(initial)))
  type Listener = Parameters<StorageApi['onChanged']['addListener']>[0]
  const listeners = new Set<Listener>()
  const emit = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area = 'local') => {
    for (const fn of listeners) fn(changes, area)
  }
  const writes: Record<string, unknown>[] = []
  const api: StorageApi = {
    local: {
      async get(keys) {
        const list = keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(list.filter(k => data.has(k)).map(k => [k, structuredClone(data.get(k))]))
      },
      async set(items) {
        writes.push(structuredClone(items))
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
  return { api, data, emit, listeners, writes }
}
