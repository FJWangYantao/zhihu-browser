// 用户插件的安装、更新、启用、卸载（在后台运行）。
//
// 顺序很重要：知乎页面看到索引变化就会重新加载插件，所以先让新的代码就位（注册用户脚本、
// 执行到已打开的页面），最后才写索引。

import {
  type CompiledPlugin,
  CompileError,
  compareVersions,
  compilePlugin,
  diffPermissions,
  hostPermissionPattern,
  networkHosts,
  type PermissionChange,
} from '@zhihu-browser/installer'
import type { PluginMeta } from '@zhihu-browser/sdk'
import { DATA_PREFIX, SETTINGS_PREFIX, type StorageApi } from '../storage'
import { buildCode, reconcileScripts, scriptId, type UserScriptsApi } from './scripts'
import {
  randomSecret as defaultSecret,
  readCode,
  readIndex,
  USER_CODE_PREFIX,
  type UserPluginCode,
  type UserPluginEntry,
  type UserPluginIndex,
  writeCode,
  writeIndex,
} from './store'

export interface ManagerDeps {
  storage: StorageApi
  /** 不可用（没有开启"允许用户脚本"、浏览器不支持）时返回 undefined */
  userScripts(): Promise<UserScriptsApi | undefined>
  /** SDK 运行时脚本的内容 */
  runtimeCode(): Promise<string>
  /** 已打开的知乎标签页 */
  zhihuTabs(): Promise<number[]>
  /** 官方插件的 id：用户插件不能重名 */
  officialIds: readonly string[]
  now?(): number
  secret?(): string
}

export type InstallAction = 'install' | 'update' | 'downgrade' | 'reinstall'

export interface InstallPlan {
  meta: PluginMeta
  compiled: CompiledPlugin
  action: InstallAction
  /** 已安装的同 id 插件 */
  existing?: UserPluginEntry
  /** 更新时权限的变化；新增的需要用户确认 */
  permissions: PermissionChange
  /** 需要访问的外部域名 */
  hosts: string[]
  /** 对应的浏览器主机权限，如 '*://api.example.com/*' */
  hostPatterns: string[]
}

/** 给设置页看的部分（不含转译后的代码） */
export type PlanView = Omit<InstallPlan, 'compiled'>

export const planView = ({ compiled: _compiled, ...view }: InstallPlan): PlanView => view

export class InstallError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [message],
  ) {
    super(message)
    this.name = 'InstallError'
  }
}

export interface InstallResult {
  entry: UserPluginEntry
  plan: InstallPlan
  /** 用户脚本能否使用；不能时插件已保存，但要开启"允许用户脚本"后才能运行 */
  scriptsAvailable: boolean
  /** 浏览器不能把新代码执行到已打开的页面（没有 userScripts.execute）：要刷新知乎页面才会用上新代码 */
  needsRefresh: boolean
}

export interface Manager {
  /** 解析并检查插件，不保存、不执行 */
  plan(source: string, fileName?: string): Promise<InstallPlan>
  install(source: string, fileName?: string, options?: { enabled?: boolean }): Promise<InstallResult>
  setEnabled(id: string, enabled: boolean): Promise<void>
  uninstall(id: string): Promise<void>
  /** 让注册的用户脚本和已安装的插件一致（后台启动时调用） */
  reconcile(): Promise<{
    registered: string[]
    added: string[]
    removed: string[]
    skipped: string[]
    available: boolean
  }>
  status(): Promise<{ available: boolean }>
  list(): Promise<UserPluginIndex>
}

export function createManager(deps: ManagerDeps): Manager {
  const { storage } = deps
  const now = deps.now ?? Date.now
  const newSecret = deps.secret ?? defaultSecret
  let chain: Promise<unknown> = Promise.resolve()
  /** 同一时间只做一件事：安装、启用、卸载都是"读索引 → 改 → 写索引" */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }

  async function makePlan(source: string, fileName: string | undefined, index: UserPluginIndex): Promise<InstallPlan> {
    let compiled: CompiledPlugin
    try {
      compiled = compilePlugin(source, fileName)
    } catch (e) {
      if (e instanceof CompileError) throw new InstallError(e.message, e.problems)
      throw e
    }
    const { meta } = compiled
    if (deps.officialIds.includes(meta.id)) {
      throw new InstallError(`id「${meta.id}」已被官方插件使用，请换一个 id`)
    }
    const existing = index[meta.id]
    let action: InstallAction = 'install'
    if (existing) {
      const order = compareVersions(meta.version, existing.meta.version)
      action = order > 0 ? 'update' : order < 0 ? 'downgrade' : 'reinstall'
    }
    const hosts = networkHosts(meta)
    return {
      meta,
      compiled,
      action,
      ...(existing ? { existing } : {}),
      permissions: diffPermissions(existing?.meta, meta),
      hosts,
      hostPatterns: hosts.map(hostPermissionPattern),
    }
  }

  async function executeInTabs(api: UserScriptsApi, id: string, code: string): Promise<void> {
    if (!api.execute) return
    for (const tabId of await deps.zhihuTabs()) {
      try {
        await api.execute({
          target: { tabId },
          js: [{ code }],
          world: 'USER_SCRIPT',
          worldId: scriptId(id),
          injectImmediately: true,
        })
      } catch {
        // 标签页正在加载、已被丢弃等：下次打开页面时会按注册的脚本运行
      }
    }
  }

  /** 注册用户脚本，并把一个插件的最新代码执行到已打开的页面 */
  async function deploy(api: UserScriptsApi, index: UserPluginIndex, id: string): Promise<void> {
    const runtime = await deps.runtimeCode()
    await reconcileScripts(api, runtime, index, async pid => (await readCode(storage, pid))?.code)
    const entry = index[id]
    const code = entry?.enabled ? (await readCode(storage, id))?.code : undefined
    if (entry && code !== undefined) {
      await executeInTabs(api, id, buildCode(runtime, entry.secret, code))
    }
  }

  return {
    plan: async (source, fileName) => makePlan(source, fileName, await readIndex(storage)),

    install: (source, fileName, options = {}) =>
      serial(async () => {
        const index = await readIndex(storage)
        const plan = await makePlan(source, fileName, index)
        const { meta } = plan
        const stamp = now()
        const code: UserPluginCode = { source, code: plan.compiled.code, ...(fileName ? { fileName } : {}) }
        const entry: UserPluginEntry = {
          meta,
          // 更新时沿用密钥：已打开的页面不用换通道
          secret: plan.existing?.secret ?? newSecret(),
          enabled: plan.existing ? plan.existing.enabled : (options.enabled ?? true),
          installedAt: plan.existing?.installedAt ?? stamp,
          updatedAt: stamp,
          rev: (plan.existing?.rev ?? 0) + 1,
        }
        await writeCode(storage, meta.id, code)
        const next = { ...index, [meta.id]: entry }
        const api = await deps.userScripts()
        if (api && entry.enabled) await deploy(api, next, meta.id)
        await writeIndex(storage, next)
        const needsRefresh =
          api !== undefined && entry.enabled && typeof api.execute !== 'function' && (await deps.zhihuTabs()).length > 0
        return { entry, plan, scriptsAvailable: api !== undefined, needsRefresh }
      }),

    setEnabled: (id, enabled) =>
      serial(async () => {
        const index = await readIndex(storage)
        const entry = index[id]
        if (!entry) throw new InstallError(`没有安装插件 ${id}`)
        if (entry.enabled === enabled) return
        const next = { ...index, [id]: { ...entry, enabled, updatedAt: now(), rev: entry.rev + 1 } }
        const api = await deps.userScripts()
        if (enabled) {
          if (api) await deploy(api, next, id)
          await writeIndex(storage, next)
        } else {
          // 先让页面停掉插件，再撤销注册
          await writeIndex(storage, next)
          if (api)
            await reconcileScripts(
              api,
              await deps.runtimeCode(),
              next,
              async pid => (await readCode(storage, pid))?.code,
            )
        }
      }),

    uninstall: id =>
      serial(async () => {
        const index = await readIndex(storage)
        if (!index[id]) return
        const { [id]: _removed, ...rest } = index
        await writeIndex(storage, rest)
        const api = await deps.userScripts()
        if (api)
          await reconcileScripts(api, await deps.runtimeCode(), rest, async pid => (await readCode(storage, pid))?.code)
        const all = await storage.local.get(null)
        const doomed = Object.keys(all).filter(
          k => k === USER_CODE_PREFIX + id || k === SETTINGS_PREFIX + id || k.startsWith(`${DATA_PREFIX}${id}:`),
        )
        if (doomed.length) await storage.local.remove(doomed)
      }),

    reconcile: () =>
      serial(async () => {
        const api = await deps.userScripts()
        if (!api) return { registered: [], added: [], removed: [], skipped: [], available: false }
        const index = await readIndex(storage)
        const runtime = await deps.runtimeCode()
        const result = await reconcileScripts(api, runtime, index, async pid => (await readCode(storage, pid))?.code)
        // 新注册的脚本只对之后打开的页面生效：已经打开的知乎页面里也执行一遍
        for (const id of result.added) {
          const entry = index[id]
          const code = (await readCode(storage, id))?.code
          if (entry && code !== undefined) await executeInTabs(api, id, buildCode(runtime, entry.secret, code))
        }
        return { ...result, available: true }
      }),

    status: async () => ({ available: (await deps.userScripts()) !== undefined }),
    list: () => readIndex(storage),
  }
}
