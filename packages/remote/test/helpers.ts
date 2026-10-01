import {
  type ContentTarget,
  createHost,
  createMemorySettingsBackend,
  createMemoryStorageBackend,
  type HostOptions,
  type HostServices,
  type LogEntry,
} from '@zhihu-browser/core'
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
} from '@zhihu-browser/sdk'
import {
  domElementReceiver,
  domElementSharer,
  domTransport,
  memoryElements,
  remotePlugin,
  startRuntime,
} from '../src/index'
import { memoryTransports } from '../src/wire'

export const flush = () => new Promise(resolve => setTimeout(resolve, 0))

export const page = (type: PageInfo['type'], url = `https://www.zhihu.com/${type}`): PageInfo => ({
  type,
  url,
  params: {},
})

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

export const feedItem = (overrides: Partial<FeedItem> = {}): FeedItem => ({
  id: 'f1',
  kind: 'content',
  content: answer(),
  ...overrides,
})

export const comment = (overrides: Partial<Comment> = {}): Comment => ({ id: 'c1', text: '一条评论', ...overrides })

/** 模拟适配层为一个内容元素提供的东西 */
export function target(data: Answer = answer()) {
  const controller = new AbortController()
  const el = document.createElement('div')
  const decorations = new Set<string>()
  const actions: { label: string; onClick: () => void }[] = []
  const calls: string[] = []
  const add = (name: string): Dispose => {
    decorations.add(name)
    return () => decorations.delete(name)
  }
  const ui: ItemUI = {
    badge: (text, options) => add(`badge:${text}${options?.tone ? `:${options.tone}` : ''}`),
    fold: reason => add(`fold:${reason}`),
    addAction(action) {
      actions.push(action)
      return add(`action:${action.label}`)
    },
    mount(position, render) {
      const container = document.createElement('div')
      container.dataset.position = position
      el.append(container)
      const dispose = render(container)
      const remove = add(`mount:${position}`)
      return () => {
        remove()
        if (typeof dispose === 'function') dispose()
      }
    },
  }
  const handle: ContentHandle = {
    data,
    expand: () => void calls.push('expand'),
    collapse: () => void calls.push('collapse'),
    scrollIntoView: () => void calls.push('scrollIntoView'),
    isVisible: () => true,
  }
  const t: ContentTarget = { el, ui, signal: controller.signal, handle }
  return { target: t, el, decorations, actions, calls, handle, remove: () => controller.abort() }
}

export interface RemoteSetup {
  /** 用户脚本环境一侧运行的插件入口 */
  entry: (z: PluginAPI) => unknown
  meta?: Partial<PluginMeta>
  settings?: Record<string, unknown>
  hostOptions?: Omit<Partial<HostOptions>, 'services'>
  /** 不启动运行时（模拟没有开启"允许用户脚本"） */
  noRuntime?: boolean
  /** 用真正的 DOM 事件通道（给出通道名）而不是内存通道 */
  dom?: string
}

export async function setupRemote(options: RemoteSetup) {
  const meta = { id: 'user-plugin', name: '用户插件', version: '1.0.0', api: 1, ...options.meta } as PluginMeta
  const settings = createMemorySettingsBackend(options.settings ? { [meta.id]: options.settings } : {})
  const storage = createMemoryStorageBackend()
  const logs: LogEntry[] = []
  const styles = new Set<string>()
  const toasts: string[] = []
  const fetches: { url: string }[] = []
  const globalMounts: { slot: string; container: HTMLElement; disposed: boolean }[] = []
  const contents: ContentHandle[] = []

  const services: HostServices = {
    settings,
    storage,
    async fetch(_pluginId, url) {
      fetches.push({ url })
      return {
        status: 200,
        ok: true,
        headers: { 'content-type': 'application/json' },
        text: async () => '{"hello":"world"}',
        json: async <T>() => ({ hello: 'world' }) as T,
      }
    },
    ui: {
      toast: message => void toasts.push(message),
      confirm: async () => true,
      mount(slot, render) {
        // 真实的界面在调用渲染函数之前，容器已经挂到页面上了
        const record = { slot, container: document.createElement('div'), disposed: false }
        document.body.append(record.container)
        globalMounts.push(record)
        const dispose = render(record.container)
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
    contents: { all: () => contents, current: () => contents[0] },
    log: entry => logs.push(entry),
  }
  const host = createHost({ ...options.hostOptions, services })

  const channel = options.dom
  const [hostSide, runtimeSide] = channel
    ? [domTransport(document, channel, 'host'), domTransport(document, channel, 'runtime')]
    : memoryTransports()
  const elements = channel
    ? { sharer: domElementSharer(channel), receiver: domElementReceiver(document, channel) }
    : memoryElements()
  const runtime = options.noRuntime
    ? undefined
    : startRuntime({ transport: runtimeSide, elements: elements.receiver, module: { default: options.entry } })
  const module = remotePlugin({ meta, transport: hostSide, elements: elements.sharer, startTimeoutMs: 50 })
  const info = await host.load(module)
  return { host, info, runtime, settings, storage, logs, styles, toasts, fetches, globalMounts, contents, meta }
}
