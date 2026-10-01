// 把用户插件注册成 chrome.userScripts 的用户脚本。
//
// 每个插件一个独立的运行环境（worldId）：互不干扰，也读不到彼此的变量。
// 注册的代码 = SDK 运行时 + 插件转译后的脚本，只对知乎页面生效，在文档开始时执行。
// 插件文件顶层的代码要等宿主发出 start 才会执行（见 packages/remote），所以没有启用的插件、
// 安全模式下的插件什么也不会运行。

import type { UserPluginIndex } from './store'

export const ZHIHU_MATCHES = ['*://*.zhihu.com/*']

/** 用到的 userScripts API（便于测试时替换） */
export interface UserScriptsApi {
  register(scripts: RegisteredScript[]): Promise<void>
  update(scripts: RegisteredScript[]): Promise<void>
  unregister(filter?: { ids?: string[] }): Promise<void>
  getScripts(filter?: { ids?: string[] }): Promise<{ id: string }[]>
  configureWorld(properties: { worldId?: string; csp?: string; messaging?: boolean }): Promise<void>
  execute?(injection: {
    target: { tabId: number }
    js: { code: string }[]
    world?: 'USER_SCRIPT'
    worldId?: string
    injectImmediately?: boolean
  }): Promise<unknown>
}

export interface RegisteredScript {
  id: string
  matches: string[]
  js: { code: string }[]
  runAt: 'document_start'
  world: 'USER_SCRIPT'
  worldId: string
  allFrames: false
}

export const scriptId = (pluginId: string) => `zb-${pluginId}`

/** 组装一个插件注册给 userScripts 的代码 */
export function buildCode(runtimeCode: string, secret: string, pluginCode: string): string {
  return `(function(){
var __zbBoot = (function(){${runtimeCode}
;return globalThis.__zbBoot})();
__zbBoot(${JSON.stringify(secret)}, function(exports){
${pluginCode}
});
})();`
}

export function buildScript(pluginId: string, code: string): RegisteredScript {
  const id = scriptId(pluginId)
  return {
    id,
    matches: ZHIHU_MATCHES,
    js: [{ code }],
    runAt: 'document_start',
    world: 'USER_SCRIPT',
    worldId: id,
    allFrames: false,
  }
}

/** 用户脚本环境的统一配置：不开放扩展的消息通道（插件只能通过 DOM 事件和代理通信） */
export async function configureWorlds(api: UserScriptsApi, pluginIds: string[]): Promise<void> {
  for (const id of pluginIds) await api.configureWorld({ worldId: scriptId(id), messaging: false })
}

/**
 * 让注册的用户脚本和期望的一致：启用的插件都注册（代码变了的更新），没有启用或已卸载的撤销。
 * codeOf 返回插件转译后的脚本，读不到时跳过这个插件。
 */
export async function reconcileScripts(
  api: UserScriptsApi,
  runtimeCode: string,
  index: UserPluginIndex,
  codeOf: (id: string) => Promise<string | undefined>,
): Promise<{ registered: string[]; added: string[]; removed: string[]; skipped: string[] }> {
  const wanted = Object.values(index).filter(e => e.enabled)
  const existing = new Set((await api.getScripts()).map(s => s.id).filter(id => id.startsWith('zb-')))
  const registered: string[] = []
  const skipped: string[] = []
  const scripts: RegisteredScript[] = []
  for (const entry of wanted) {
    const code = await codeOf(entry.meta.id)
    if (code === undefined) {
      skipped.push(entry.meta.id)
      continue
    }
    scripts.push(buildScript(entry.meta.id, buildCode(runtimeCode, entry.secret, code)))
    registered.push(entry.meta.id)
  }
  const keep = new Set(scripts.map(s => s.id))
  const removed = [...existing].filter(id => !keep.has(id))
  if (removed.length) await api.unregister({ ids: removed })
  await configureWorlds(api, registered)
  const toUpdate = scripts.filter(s => existing.has(s.id))
  const toAdd = scripts.filter(s => !existing.has(s.id))
  if (toUpdate.length) await api.update(toUpdate)
  if (toAdd.length) await api.register(toAdd)
  return {
    registered,
    added: toAdd.map(s => s.id.slice('zb-'.length)),
    removed: removed.map(id => id.slice('zb-'.length)),
    skipped,
  }
}
