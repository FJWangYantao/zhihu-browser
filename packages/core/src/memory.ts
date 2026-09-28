import type { SettingsBackend, StorageBackend } from './types'

/**
 * 内存里的设置存储，用于测试和开发。
 * `update` 模拟设置在别处被修改（例如设置页），会通知订阅者。
 */
export function createMemorySettingsBackend(initial: Record<string, Record<string, unknown>> = {}) {
  const data = new Map<string, Record<string, unknown>>(Object.entries(structuredClone(initial)))
  const listeners = new Map<string, Set<(values: Record<string, unknown>) => void>>()

  const backend: SettingsBackend & {
    update(pluginId: string, values: Record<string, unknown>): void
    peek(pluginId: string): Record<string, unknown> | undefined
  } = {
    async load(pluginId) {
      return structuredClone(data.get(pluginId) ?? {})
    },
    async save(pluginId, values) {
      data.set(pluginId, structuredClone(values))
    },
    subscribe(pluginId, onChange) {
      const set = listeners.get(pluginId) ?? new Set()
      listeners.set(pluginId, set)
      set.add(onChange)
      return () => set.delete(onChange)
    },
    update(pluginId, values) {
      data.set(pluginId, structuredClone(values))
      for (const fn of listeners.get(pluginId) ?? []) fn(structuredClone(values))
    },
    peek(pluginId) {
      return data.get(pluginId)
    },
  }
  return backend
}

/** 内存里的插件存储，用于测试和开发。 */
export function createMemoryStorageBackend(): StorageBackend {
  const data = new Map<string, Map<string, unknown>>()
  const ns = (namespace: string) => {
    let m = data.get(namespace)
    if (!m) {
      m = new Map()
      data.set(namespace, m)
    }
    return m
  }
  return {
    async get(namespace, key) {
      const value = ns(namespace).get(key)
      return value === undefined ? undefined : structuredClone(value)
    },
    async set(namespace, key, value) {
      ns(namespace).set(key, structuredClone(value))
    },
    async delete(namespace, key) {
      ns(namespace).delete(key)
    },
    async keys(namespace) {
      return [...ns(namespace).keys()]
    },
  }
}
