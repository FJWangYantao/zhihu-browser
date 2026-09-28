import type {
  Answer,
  Comment,
  ContentHandle,
  Dispose,
  FeedItem,
  ItemUI,
  PageInfo,
  PluginAPI,
  PluginMeta,
  PluginModule,
} from '@zhihu-browser/sdk'
import type { ContentTarget, HostOptions, HostServices, LogEntry } from '../src/index'
import { createHost, createMemorySettingsBackend, createMemoryStorageBackend } from '../src/index'

/** 等待所有微任务和一轮宏任务 */
export const flush = () => new Promise(resolve => setTimeout(resolve, 0))

export function plugin(meta: Partial<PluginMeta> & { id: string }, entry: (z: PluginAPI) => unknown): PluginModule {
  return {
    meta: { name: meta.id, version: '1.0.0', api: 1, ...meta } as PluginMeta,
    default: entry as PluginModule['default'],
  }
}

export function setup(
  options: Omit<Partial<HostOptions>, 'services'> & { settings?: Record<string, Record<string, unknown>> } = {},
) {
  const settings = createMemorySettingsBackend(options.settings)
  const storage = createMemoryStorageBackend()
  const logs: LogEntry[] = []
  const styles = new Set<string>()
  const toasts: string[] = []
  const mounts: { slot: string; disposed: boolean }[] = []
  const fetches: { pluginId: string; url: string; timeout: number }[] = []
  let clock = 0

  const services: HostServices = {
    settings,
    storage,
    async fetch(pluginId, url, init) {
      fetches.push({ pluginId, url, timeout: init.timeout })
      return { status: 200, ok: true, headers: {}, text: async () => '', json: async <T>() => ({}) as T }
    },
    ui: {
      toast: message => {
        toasts.push(message)
      },
      confirm: async () => true,
      mount(slot, render) {
        const record = { slot, disposed: false }
        mounts.push(record)
        const dispose = render({} as HTMLElement)
        return () => {
          record.disposed = true
          if (typeof dispose === 'function') dispose()
        }
      },
    },
    addStyle(css) {
      styles.add(css)
      return () => styles.delete(css)
    },
    contents: { all: () => [], current: () => undefined },
    log: entry => logs.push(entry),
    now: () => clock,
  }
  const { settings: _, ...hostOptions } = options
  const host = createHost({ ...hostOptions, services })
  return {
    host,
    settings,
    storage,
    logs,
    styles,
    toasts,
    mounts,
    fetches,
    advance(ms: number) {
      clock += ms
    },
  }
}

/** 模拟适配层为一个元素提供的东西 */
export function target(data: Answer = answer()) {
  const controller = new AbortController()
  const decorations = new Set<string>()
  const actions: { label: string; onClick: () => void }[] = []
  const add = (name: string): Dispose => {
    decorations.add(name)
    return () => decorations.delete(name)
  }
  const ui: ItemUI = {
    badge: text => add(`badge:${text}`),
    fold: reason => add(`fold:${reason}`),
    addAction(action) {
      actions.push(action)
      return add(`action:${action.label}`)
    },
    mount(position, render) {
      const dispose = render({} as HTMLElement)
      const remove = add(`mount:${position}`)
      return () => {
        remove()
        if (typeof dispose === 'function') dispose()
      }
    },
  }
  const handle: ContentHandle = {
    data,
    expand() {},
    collapse() {},
    scrollIntoView() {},
    isVisible: () => true,
  }
  const t: ContentTarget = { el: {} as HTMLElement, ui, signal: controller.signal, handle }
  return { target: t, decorations, actions, remove: () => controller.abort() }
}

export function answer(overrides: Partial<Answer> = {}): Answer {
  return {
    type: 'answer',
    id: '1',
    url: 'https://www.zhihu.com/question/9/answer/1',
    title: '一个问题',
    question: { id: '9', title: '一个问题' },
    ...overrides,
  }
}

export function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return { id: 'f1', kind: 'content', content: answer(), ...overrides }
}

export function comment(overrides: Partial<Comment> = {}): Comment {
  return { id: 'c1', text: '一条评论', ...overrides }
}

export const page = (type: PageInfo['type'], url = `https://www.zhihu.com/${type}`): PageInfo => ({
  type,
  url,
  params: {},
})
