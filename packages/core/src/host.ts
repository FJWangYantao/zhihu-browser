import type {
  Answer,
  Comment,
  Content,
  ContentContext,
  Dispose,
  FeedItem,
  ItemContext,
  ItemUI,
  PageContext,
  PageInfo,
  PluginAPI,
  PluginMeta,
  PluginModule,
  Render,
  SearchResult,
} from '@zhihu-browser/sdk'
import { checkSettingValue, PluginLoadError, sanitizeSettings, validateMeta } from './meta'
import { Monitor } from './monitor'
import { checkFetchUrl } from './permissions'
import { normalizeShortcut, ShortcutRegistry } from './shortcuts'
import type {
  CommandInfo,
  ContentTarget,
  FilterKind,
  HookKind,
  HostEvents,
  HostOptions,
  ItemTarget,
  LogEntry,
  LogLevel,
  PluginInfo,
  PluginState,
  ShortcutInfo,
} from './types'

export interface Host {
  /** 加载插件；enabled 为 false 或处于安全模式时只登记、不运行。meta 不合法时抛出 PluginLoadError。 */
  load<M extends PluginMeta>(module: PluginModule<M>, options?: { enabled?: boolean }): Promise<PluginInfo>
  /** 替换同一 id 的插件（热重载），保持原来的启用状态 */
  reload<M extends PluginMeta>(module: PluginModule<M>): Promise<PluginInfo>
  unload(id: string): void
  enable(id: string): Promise<PluginInfo>
  disable(id: string, reason?: string): PluginInfo
  plugins(): PluginInfo[]
  plugin(id: string): PluginInfo | undefined
  logs(id: string): LogEntry[]

  // ---------- 由适配层调用 ----------
  readonly page: PageInfo | undefined
  /** 进入新页面（包括首次） */
  setPage(page: PageInfo): void
  hasFilters(kind: FilterKind): boolean
  /** 运行过滤函数：任何一个返回 false 就去掉；过滤函数出错时按保留处理 */
  shouldKeep(kind: 'feed', item: FeedItem): boolean
  shouldKeep(kind: 'answers', item: Answer): boolean
  shouldKeep(kind: 'comments', item: Comment): boolean
  shouldKeep(kind: 'search', item: SearchResult): boolean
  /** 页面上出现了一块内容；target.signal 中止时视为移除 */
  addContent(content: Content, target: ContentTarget): void
  /** 页面上出现了一条评论；target.signal 中止时视为移除 */
  addComment(comment: Comment, target: ItemTarget): void

  // ---------- 由界面调用 ----------
  /** 当前页面可用的命令 */
  commands(page?: PageInfo): CommandInfo[]
  runCommand(id: string): Promise<void>
  shortcuts(): ShortcutInfo[]
  /** 按下快捷键（规范化前后的写法都可以）；有插件处理时返回 true */
  runShortcut(keys: string, page?: PageInfo): boolean

  on<K extends keyof HostEvents>(event: K, listener: (payload: HostEvents[K]) => void): Dispose
  dispose(): void
}

type PageHandler = (page: PageInfo, ctx: PageContext) => void
type ContentHandler = (content: Content, ctx: ContentContext) => void
type CommentHandler = (comment: Comment, ctx: ItemContext) => void
type AnyFilter = (item: never) => unknown

interface LiveItem<T, Target extends ItemTarget> {
  data: T
  target: Target
}

interface HandlerRecord<F> {
  fn: F
  /** 已经交给这个处理函数的内容，避免补发时重复 */
  seen: WeakSet<object>
  /** 已经交给这个处理函数的页面 */
  seenPage?: PageInfo
}

/** 插件的一次运行（从启用到停用）。 */
interface Run {
  controller: AbortController
  disposers: Set<Dispose>
  cleanup?: Dispose
  settings: Record<string, unknown>
  settingsListeners: Set<(changed: Record<string, unknown>) => void>
  unsubscribeSettings?: Dispose
  pageHandlers: Set<HandlerRecord<PageHandler>>
  pageContext?: { page: PageInfo; controller: AbortController; ctx: PageContext }
  filters: Map<FilterKind, Set<AnyFilter>>
  contentHandlers: Set<HandlerRecord<ContentHandler>>
  commentHandlers: Set<HandlerRecord<CommentHandler>>
  warnedAsyncFilter: boolean
}

interface Instance {
  id: string
  module: PluginModule
  meta: PluginMeta
  enabled: boolean
  state: PluginState
  reason?: string
  monitor: Monitor
  logs: LogEntry[]
  run?: Run
}

interface CommandRecord {
  inst: Instance
  run: Run
  info: CommandInfo
  fn: () => unknown
}

const FILTER_KINDS: readonly FilterKind[] = ['feed', 'answers', 'comments', 'search']
const MAX_LOGS = 200
const EMPTY_PAGE: PageInfo = Object.freeze<PageInfo>({ type: 'other', url: '', params: Object.freeze({}) })
const HOOK_NAMES: Record<HookKind, string> = {
  entry: '启动',
  page: '页面钩子',
  filter: '过滤函数',
  content: '渲染钩子',
  comment: '评论钩子',
  command: '命令',
  shortcut: '快捷键',
  settings: '设置回调',
  ui: '界面回调',
  cleanup: '清理函数',
}
const noop: Dispose = () => {}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function'

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  try {
    return JSON.stringify(arg) ?? String(arg)
  } catch {
    return String(arg)
  }
}

function toJsonValue(value: unknown): unknown {
  let text: string | undefined
  try {
    text = JSON.stringify(value)
  } catch (e) {
    throw new TypeError(`值不能被 JSON 序列化：${formatArg(e)}`)
  }
  if (text === undefined) throw new TypeError('值不能被 JSON 序列化')
  return JSON.parse(text)
}

export function createHost(options: HostOptions): Host {
  const { services } = options
  const now = services.now ?? (() => performance.now())
  const windowMs = options.errorWindowMs ?? 60_000
  const maxErrors = options.maxErrors ?? 10
  const safeMode = options.safeMode ?? false

  const instances = new Map<string, Instance>()
  const listeners = new Map<keyof HostEvents, Set<(payload: never) => void>>()
  const commands = new Map<string, CommandRecord>()
  const shortcutRegistry = new ShortcutRegistry()
  const liveContents = new Set<LiveItem<Content, ContentTarget>>()
  const liveComments = new Set<LiveItem<Comment, ItemTarget>>()
  const pendingEvents = new Set<'filtersChanged' | 'commandsChanged' | 'shortcutsChanged'>()
  let currentPage: PageInfo | undefined
  let disposed = false

  // ---------- 事件 ----------

  function emit<K extends keyof HostEvents>(event: K, payload: HostEvents[K]): void {
    for (const fn of [...(listeners.get(event) ?? [])]) {
      try {
        ;(fn as (p: HostEvents[K]) => void)(payload)
      } catch (e) {
        console.error('[zhihu-browser] 宿主事件处理出错', e)
      }
    }
  }

  /** 同一轮事件循环里的多次变化只通知一次 */
  function schedule(event: 'filtersChanged' | 'commandsChanged' | 'shortcutsChanged'): void {
    if (pendingEvents.has(event)) return
    pendingEvents.add(event)
    queueMicrotask(() => {
      pendingEvents.delete(event)
      if (!disposed) emit(event, undefined)
    })
  }

  // ---------- 日志与状态 ----------

  function log(inst: Instance, level: LogLevel, message: string): void {
    const entry: LogEntry = { pluginId: inst.id, level, time: Date.now(), message }
    inst.logs.push(entry)
    if (inst.logs.length > MAX_LOGS) inst.logs.splice(0, inst.logs.length - MAX_LOGS)
    if (services.log) services.log(entry)
    else console[level](`[插件 ${inst.id}]`, message)
    emit('log', entry)
  }

  function info(inst: Instance): PluginInfo {
    return {
      id: inst.id,
      meta: inst.meta,
      state: inst.state,
      enabled: inst.enabled,
      ...(inst.reason ? { reason: inst.reason } : {}),
      stats: inst.monitor.snapshot(),
    }
  }

  const isRunning = (inst: Instance, run: Run) => inst.run === run && !run.controller.signal.aborted

  // ---------- 调用插件代码：计时、捕获异常、熔断 ----------

  function fail(inst: Instance, run: Run, kind: HookKind, error: unknown): void {
    log(inst, 'error', `${HOOK_NAMES[kind]}出错：${formatArg(error)}`)
    if (inst.monitor.recordError(now()) && isRunning(inst, run)) {
      deactivate(inst, 'failed', `${Math.round(windowMs / 1000)} 秒内报错超过 ${maxErrors} 次，已自动停用`)
    }
  }

  function call<T>(inst: Instance, run: Run, kind: HookKind, fn: () => T, fallback: T): T {
    if (!isRunning(inst, run)) return fallback
    const start = now()
    try {
      const result = fn()
      if (isThenable(result)) result.then(undefined, e => fail(inst, run, kind, e))
      return result
    } catch (e) {
      fail(inst, run, kind, e)
      return fallback
    } finally {
      inst.monitor.record(kind, now() - start)
    }
  }

  function wrap<A extends unknown[]>(inst: Instance, run: Run, kind: HookKind, fn: (...args: A) => unknown) {
    return (...args: A): void => {
      call(inst, run, kind, () => fn(...args), undefined)
    }
  }

  /** 清理函数在插件停用后也要执行，出错只记日志、不计入熔断 */
  function safeCleanup(inst: Instance, fn: () => unknown): void {
    try {
      fn()
    } catch (e) {
      log(inst, 'error', `${HOOK_NAMES.cleanup}出错：${formatArg(e)}`)
    }
  }

  function track(inst: Instance, run: Run, dispose: Dispose): Dispose {
    let done = false
    const tracked: Dispose = () => {
      if (done) return
      done = true
      run.disposers.delete(tracked)
      safeCleanup(inst, dispose)
    }
    run.disposers.add(tracked)
    return tracked
  }

  function wrapRender(inst: Instance, run: Run, render: Render): Render {
    return container => {
      const result = call(inst, run, 'ui', () => render(container), undefined)
      return typeof result === 'function' ? () => safeCleanup(inst, result) : undefined
    }
  }

  // ---------- 页面 ----------

  function pageContext(run: Run, page: PageInfo): PageContext {
    if (run.pageContext?.page !== page) {
      run.pageContext?.controller.abort()
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, run.controller.signal])
      run.pageContext = { page, controller, ctx: { page, signal } }
    }
    return run.pageContext.ctx
  }

  function deliverPage(inst: Instance, run: Run, rec: HandlerRecord<PageHandler>): void {
    const page = currentPage
    if (!page || rec.seenPage === page || !run.pageHandlers.has(rec) || !isRunning(inst, run)) return
    rec.seenPage = page
    call(inst, run, 'page', () => rec.fn(page, pageContext(run, page)), undefined)
  }

  // ---------- 内容与评论 ----------

  function itemContext(inst: Instance, run: Run, target: ItemTarget): ItemContext {
    const signal = AbortSignal.any([target.signal, run.controller.signal])
    /** 界面元素随插件停用而撤销；元素被移除时由适配层清理，这里只是不再跟踪 */
    const own = (make: () => Dispose): Dispose => {
      if (!isRunning(inst, run) || target.signal.aborted) return noop
      const tracked = track(inst, run, make())
      target.signal.addEventListener('abort', () => run.disposers.delete(tracked), { once: true })
      return tracked
    }
    const ui: ItemUI = {
      badge: (text, opts) => own(() => target.ui.badge(String(text), opts)),
      fold: reason => own(() => target.ui.fold(String(reason))),
      addAction: action =>
        own(() => target.ui.addAction({ ...action, onClick: wrap(inst, run, 'ui', action.onClick) })),
      mount: (position, render) => own(() => target.ui.mount(position, wrapRender(inst, run, render))),
    }
    return { page: currentPage ?? EMPTY_PAGE, signal, ui, el: target.el }
  }

  function deliverContent(
    inst: Instance,
    run: Run,
    rec: HandlerRecord<ContentHandler>,
    item: LiveItem<Content, ContentTarget>,
  ): void {
    if (rec.seen.has(item) || item.target.signal.aborted || !run.contentHandlers.has(rec) || !isRunning(inst, run)) {
      return
    }
    rec.seen.add(item)
    const ctx: ContentContext = { ...itemContext(inst, run, item.target), handle: item.target.handle }
    call(inst, run, 'content', () => rec.fn(item.data, ctx), undefined)
  }

  function deliverComment(
    inst: Instance,
    run: Run,
    rec: HandlerRecord<CommentHandler>,
    item: LiveItem<Comment, ItemTarget>,
  ): void {
    if (rec.seen.has(item) || item.target.signal.aborted || !run.commentHandlers.has(rec) || !isRunning(inst, run)) {
      return
    }
    rec.seen.add(item)
    call(inst, run, 'comment', () => rec.fn(item.data, itemContext(inst, run, item.target)), undefined)
  }

  // ---------- 插件 API ----------

  function createApi(inst: Instance, run: Run): PluginAPI {
    const running = () => isRunning(inst, run)
    const ensureRunning = () => {
      if (!running()) throw new Error(`插件 ${inst.id} 已停用`)
    }
    const specs = inst.meta.settings ?? {}
    const checkKey = (key: unknown) => {
      if (typeof key !== 'string' || !key || key.length > 256)
        throw new TypeError('存储的键必须是 1～256 个字符的字符串')
    }

    const on = (event: string, handler: (...args: never[]) => void): Dispose => {
      if (typeof handler !== 'function') throw new TypeError('on() 的第二个参数必须是函数')
      if (!running()) return noop
      if (event === 'page') {
        const rec: HandlerRecord<PageHandler> = { fn: handler as PageHandler, seen: new WeakSet() }
        run.pageHandlers.add(rec)
        queueMicrotask(() => deliverPage(inst, run, rec))
        return track(inst, run, () => run.pageHandlers.delete(rec))
      }
      if (event === 'content') {
        const rec: HandlerRecord<ContentHandler> = { fn: handler as ContentHandler, seen: new WeakSet() }
        run.contentHandlers.add(rec)
        queueMicrotask(() => {
          for (const item of [...liveContents]) deliverContent(inst, run, rec, item)
        })
        return track(inst, run, () => run.contentHandlers.delete(rec))
      }
      if (event === 'comment') {
        const rec: HandlerRecord<CommentHandler> = { fn: handler as CommentHandler, seen: new WeakSet() }
        run.commentHandlers.add(rec)
        queueMicrotask(() => {
          for (const item of [...liveComments]) deliverComment(inst, run, rec, item)
        })
        return track(inst, run, () => run.commentHandlers.delete(rec))
      }
      throw new Error(`不支持的事件 ${event}（支持 page、content、comment）`)
    }

    const filter = (kind: FilterKind, fn: AnyFilter): Dispose => {
      if (!FILTER_KINDS.includes(kind)) throw new Error(`不支持的过滤类型 ${kind}（支持 ${FILTER_KINDS.join('、')}）`)
      if (typeof fn !== 'function') throw new TypeError('filter() 的第二个参数必须是函数')
      if (!running()) return noop
      let filters = run.filters.get(kind)
      if (!filters) {
        filters = new Set()
        run.filters.set(kind, filters)
      }
      filters.add(fn)
      schedule('filtersChanged')
      return track(inst, run, () => {
        filters.delete(fn)
        schedule('filtersChanged')
      })
    }

    const api: PluginAPI = {
      meta: inst.meta,
      page: () => currentPage ?? EMPTY_PAGE,
      on: on as PluginAPI['on'],
      filter: filter as PluginAPI['filter'],
      contents: {
        all: () => services.contents.all(),
        current: () => services.contents.current(),
      },

      registerCommand(id, command) {
        if (typeof id !== 'string' || !/^[\w.-]+$/.test(id)) {
          throw new Error('命令 id 只能包含字母、数字、下划线、点和连字符')
        }
        if (!command || typeof command.run !== 'function' || !command.title)
          throw new TypeError('命令需要 title 和 run')
        if (!running()) return noop
        const fullId = `${inst.id}.${id}`
        if (commands.has(fullId)) throw new Error(`命令 ${id} 已经注册过`)
        commands.set(fullId, {
          inst,
          run,
          fn: command.run,
          info: {
            id: fullId,
            pluginId: inst.id,
            title: String(command.title),
            keywords: [...(command.keywords ?? [])],
            ...(command.when ? { when: [...command.when] } : {}),
          },
        })
        schedule('commandsChanged')
        return track(inst, run, () => {
          commands.delete(fullId)
          schedule('commandsChanged')
        })
      },

      registerShortcut(keys, fn, options) {
        const canonical = normalizeShortcut(String(keys))
        if (typeof fn !== 'function') throw new TypeError('registerShortcut() 的第二个参数必须是函数')
        if (!options || typeof options.description !== 'string' || !options.description.trim()) {
          throw new TypeError('快捷键需要 description（显示在设置页和快捷键帮助里）')
        }
        if (!running()) return noop
        const remove = shortcutRegistry.add({
          keys: canonical,
          pluginId: inst.id,
          description: options.description,
          ...(options.when ? { when: [...options.when] } : {}),
          run: wrap(inst, run, 'shortcut', fn),
        })
        schedule('shortcutsChanged')
        return track(inst, run, () => {
          remove()
          schedule('shortcutsChanged')
        })
      },

      settings: {
        get: key => run.settings[key] as never,
        async set(key, value) {
          ensureRunning()
          const spec = specs[key]
          if (!spec) throw new Error(`没有声明设置项 ${key}`)
          const problem = checkSettingValue(spec, value)
          if (problem) throw new TypeError(`设置项 ${key}：${problem}`)
          const next = { ...run.settings, [key]: structuredClone(value) }
          await services.settings.save(inst.id, next)
          applySettings(inst, run, next)
        },
        onChange(handler) {
          if (typeof handler !== 'function') throw new TypeError('onChange() 的参数必须是函数')
          if (!running()) return noop
          const fn = handler as (changed: Record<string, unknown>) => void
          run.settingsListeners.add(fn)
          return track(inst, run, () => run.settingsListeners.delete(fn))
        },
      },

      ui: {
        toast(message, opts) {
          if (running()) services.ui.toast(String(message), opts)
        },
        confirm: (message, opts) => (running() ? services.ui.confirm(String(message), opts) : Promise.resolve(false)),
        mount(slot, render) {
          if (!running()) return noop
          return track(inst, run, services.ui.mount(slot, wrapRender(inst, run, render)))
        },
      },

      addStyle(css) {
        if (!running()) return noop
        return track(inst, run, services.addStyle(String(css)))
      },

      storage: {
        async get(key) {
          ensureRunning()
          checkKey(key)
          return (await services.storage.get(inst.id, key)) as never
        },
        async set(key, value) {
          ensureRunning()
          checkKey(key)
          await services.storage.set(inst.id, key, toJsonValue(value))
        },
        async delete(key) {
          ensureRunning()
          checkKey(key)
          await services.storage.delete(inst.id, key)
        },
        async keys() {
          ensureRunning()
          return services.storage.keys(inst.id)
        },
      },

      async fetch(url, init = {}) {
        ensureRunning()
        const u = checkFetchUrl(inst.meta, String(url))
        const timeout = Math.min(Math.max(init.timeout ?? 30_000, 1), 120_000)
        return services.fetch(inst.id, u.href, { ...init, timeout })
      },

      log: {
        debug: (...args) => log(inst, 'debug', args.map(formatArg).join(' ')),
        info: (...args) => log(inst, 'info', args.map(formatArg).join(' ')),
        warn: (...args) => log(inst, 'warn', args.map(formatArg).join(' ')),
        error: (...args) => log(inst, 'error', args.map(formatArg).join(' ')),
      },
    }
    return api
  }

  function applySettings(inst: Instance, run: Run, next: Record<string, unknown>): void {
    if (!isRunning(inst, run)) return
    const changed: Record<string, unknown> = {}
    for (const key of Object.keys(inst.meta.settings ?? {})) {
      if (JSON.stringify(next[key]) !== JSON.stringify(run.settings[key])) changed[key] = next[key]
    }
    if (Object.keys(changed).length === 0) return
    run.settings = deepFreeze(next)
    for (const fn of [...run.settingsListeners]) call(inst, run, 'settings', () => fn({ ...changed }), undefined)
    schedule('filtersChanged')
  }

  // ---------- 生命周期 ----------

  async function activate(inst: Instance): Promise<void> {
    if (inst.run || safeMode) return
    const run: Run = {
      controller: new AbortController(),
      disposers: new Set(),
      settings: {},
      settingsListeners: new Set(),
      pageHandlers: new Set(),
      filters: new Map(),
      contentHandlers: new Set(),
      commentHandlers: new Set(),
      warnedAsyncFilter: false,
    }
    inst.run = run
    inst.state = 'active'
    inst.reason = undefined

    let stored: Record<string, unknown> = {}
    try {
      stored = await services.settings.load(inst.id)
    } catch (e) {
      log(inst, 'warn', `读取设置失败，使用默认值：${formatArg(e)}`)
    }
    if (!isRunning(inst, run)) return
    const { values, invalid } = sanitizeSettings(inst.meta, stored)
    if (invalid.length) log(inst, 'warn', `这些设置项的值不合法，已改用默认值：${invalid.join('、')}`)
    run.settings = deepFreeze(values)
    run.unsubscribeSettings = services.settings.subscribe(inst.id, stored =>
      applySettings(inst, run, sanitizeSettings(inst.meta, stored).values),
    )

    const api = createApi(inst, run)
    const start = now()
    let result: unknown
    try {
      result = inst.module.default(api)
    } catch (e) {
      inst.monitor.record('entry', now() - start)
      return failStart(inst, e)
    }
    inst.monitor.record('entry', now() - start)
    if (isThenable(result)) {
      try {
        result = await result
      } catch (e) {
        return failStart(inst, e)
      }
    }
    if (!isRunning(inst, run)) {
      if (typeof result === 'function') safeCleanup(inst, result as Dispose)
      return
    }
    if (typeof result === 'function') run.cleanup = result as Dispose
    emit('pluginState', info(inst))
  }

  function failStart(inst: Instance, error: unknown): void {
    inst.monitor.recordError(now())
    log(inst, 'error', `${HOOK_NAMES.entry}出错：${formatArg(error)}`)
    deactivate(inst, 'failed', `启动时出错：${formatArg(error)}`)
  }

  function deactivate(inst: Instance, state: PluginState, reason: string): void {
    const run = inst.run
    inst.state = state
    inst.reason = reason
    if (run) {
      inst.run = undefined
      run.controller.abort()
      run.pageContext?.controller.abort()
      run.unsubscribeSettings?.()
      for (const dispose of [...run.disposers].reverse()) dispose()
      run.disposers.clear()
      if (run.cleanup) safeCleanup(inst, run.cleanup)
    }
    emit('pluginState', info(inst))
  }

  function get(id: string): Instance {
    const inst = instances.get(id)
    if (!inst) throw new Error(`没有加载插件 ${id}`)
    return inst
  }

  const host: Host = {
    async load(module, { enabled = true } = {}) {
      if (disposed) throw new Error('宿主已销毁')
      const meta = (module as { meta?: unknown } | undefined)?.meta
      const problems = validateMeta(meta)
      if (typeof module?.default !== 'function') problems.push('插件文件必须默认导出一个函数')
      const id =
        typeof meta === 'object' && meta !== null && typeof (meta as { id?: unknown }).id === 'string'
          ? (meta as { id: string }).id
          : undefined
      if (problems.length || !id) throw new PluginLoadError(id, problems)
      if (instances.has(id)) throw new PluginLoadError(id, ['已经加载了同一个 id 的插件'])
      const inst: Instance = {
        id,
        // 插件入口按自己的 meta 推导设置项类型；宿主内部统一当作 PluginModule 处理
        module: module as unknown as PluginModule,
        meta: deepFreeze(structuredClone(meta as PluginMeta)),
        enabled,
        state: 'inactive',
        monitor: new Monitor(windowMs, maxErrors),
        logs: [],
      }
      instances.set(id, inst)
      if (enabled && !safeMode) await activate(inst)
      else {
        inst.reason = safeMode ? '安全模式' : '未启用'
        emit('pluginState', info(inst))
      }
      return info(inst)
    },

    async reload(module) {
      const id = (module as { meta?: { id?: unknown } } | undefined)?.meta?.id
      const previous = typeof id === 'string' ? instances.get(id) : undefined
      const enabled = previous?.enabled ?? true
      if (previous) host.unload(previous.id)
      return host.load(module, { enabled })
    },

    unload(id) {
      const inst = get(id)
      deactivate(inst, 'inactive', '已卸载')
      instances.delete(id)
    },

    async enable(id) {
      const inst = get(id)
      inst.enabled = true
      inst.monitor.resetBreaker()
      if (safeMode) inst.reason = '安全模式'
      else await activate(inst)
      return info(inst)
    },

    disable(id, reason = '已停用') {
      const inst = get(id)
      inst.enabled = false
      deactivate(inst, 'inactive', reason)
      return info(inst)
    },

    plugins: () => [...instances.values()].map(info),
    plugin(id) {
      const inst = instances.get(id)
      return inst && info(inst)
    },
    logs: id => [...(instances.get(id)?.logs ?? [])],

    get page() {
      return currentPage
    },

    setPage(page) {
      currentPage = Object.freeze({ ...page, params: Object.freeze({ ...page.params }) })
      for (const inst of instances.values()) {
        const run = inst.run
        if (!run) continue
        // 离开上一个页面：即使插件已经撤销了页面钩子，之前拿到的 signal 也要中止
        if (run.pageContext && run.pageContext.page !== currentPage) {
          run.pageContext.controller.abort()
          run.pageContext = undefined
        }
        for (const rec of [...run.pageHandlers]) deliverPage(inst, run, rec)
      }
    },

    hasFilters(kind) {
      for (const inst of instances.values()) if (inst.run?.filters.get(kind)?.size) return true
      return false
    },

    shouldKeep(kind: FilterKind, item: unknown): boolean {
      for (const inst of instances.values()) {
        const run = inst.run
        const set = run?.filters.get(kind)
        if (!run || !set) continue
        for (const fn of [...set]) {
          const result = call(inst, run, 'filter', () => (fn as (item: unknown) => unknown)(item), true)
          if (isThenable(result)) {
            if (!run.warnedAsyncFilter) {
              run.warnedAsyncFilter = true
              log(inst, 'warn', '过滤函数必须是同步的，返回 Promise 时按保留处理')
            }
            continue
          }
          if (result === false) return false
        }
      }
      return true
    },

    addContent(content, target) {
      if (disposed || target.signal.aborted) return
      const item: LiveItem<Content, ContentTarget> = { data: content, target }
      liveContents.add(item)
      target.signal.addEventListener('abort', () => liveContents.delete(item), { once: true })
      for (const inst of instances.values()) {
        const run = inst.run
        if (!run) continue
        for (const rec of [...run.contentHandlers]) deliverContent(inst, run, rec, item)
      }
    },

    addComment(comment, target) {
      if (disposed || target.signal.aborted) return
      const item: LiveItem<Comment, ItemTarget> = { data: comment, target }
      liveComments.add(item)
      target.signal.addEventListener('abort', () => liveComments.delete(item), { once: true })
      for (const inst of instances.values()) {
        const run = inst.run
        if (!run) continue
        for (const rec of [...run.commentHandlers]) deliverComment(inst, run, rec, item)
      }
    },

    commands(page = currentPage) {
      return [...commands.values()]
        .filter(c => isRunning(c.inst, c.run))
        .filter(c => !c.info.when || (page !== undefined && c.info.when.includes(page.type)))
        .map(c => structuredClone(c.info))
    },

    async runCommand(id) {
      const rec = commands.get(id)
      if (!rec) return
      const result = call(rec.inst, rec.run, 'command', rec.fn, undefined)
      // 异步命令的错误已经在 call 里记录，这里只等待它结束
      if (isThenable(result)) await Promise.resolve(result).catch(() => {})
    },

    shortcuts: () => shortcutRegistry.list(),

    runShortcut(keys, page = currentPage) {
      let canonical: string
      try {
        canonical = normalizeShortcut(keys)
      } catch {
        return false
      }
      const entry = shortcutRegistry.resolve(canonical, page?.type)
      if (!entry) return false
      entry.run()
      return true
    },

    on(event, listener) {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      const fn = listener as (payload: never) => void
      set.add(fn)
      return () => set.delete(fn)
    },

    dispose() {
      if (disposed) return
      for (const id of [...instances.keys()]) host.unload(id)
      liveContents.clear()
      liveComments.clear()
      disposed = true
      listeners.clear()
    },
  }
  return host
}
