// 后台里和用户插件有关的部分：安装管理、z.fetch 代理、启动时对齐用户脚本。

import { browser } from 'wxt/browser'
import type { StorageApi } from '../storage'
import { FETCH_MESSAGE, type FetchRequest, proxyFetch, type Reply } from './fetch-proxy'
import { createManager, InstallError, type Manager, planView } from './manager'
import { MANAGE_MESSAGE, type ManageReply, type ManageRequest } from './messages'
import type { UserScriptsApi } from './scripts'
import { readIndex } from './store'

/** 浏览器的 userScripts API；没有开启"允许用户脚本"或不支持时返回 undefined */
async function getUserScripts(): Promise<UserScriptsApi | undefined> {
  const api = (browser as unknown as { userScripts?: UserScriptsApi }).userScripts
  if (!api) return undefined
  try {
    await api.getScripts()
    return api
  } catch {
    return undefined
  }
}

let runtimeCache: Promise<string> | undefined
const runtimeCode = () => {
  runtimeCache ??= fetch(browser.runtime.getURL('/user-runtime.js' as never)).then(r => r.text())
  return runtimeCache
}

async function zhihuTabs(): Promise<number[]> {
  const tabs = await browser.tabs.query({ url: '*://*.zhihu.com/*' })
  return tabs.flatMap(t => (t.id === undefined ? [] : [t.id]))
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function setupUserPlugins(officialIds: readonly string[]): Manager {
  const api = browser.storage as unknown as StorageApi
  const manager = createManager({ storage: api, userScripts: getUserScripts, runtimeCode, zhihuTabs, officialIds })

  // 浏览器重启、扩展更新、后台被唤醒时，让注册的用户脚本和已安装的插件一致
  void manager.reconcile().catch(e => console.warn('[zhihu-browser] 同步用户脚本失败', e))

  async function handleManage(request: ManageRequest): Promise<unknown> {
    switch (request.op) {
      case 'plan':
        return planView(await manager.plan(request.source, request.fileName))
      case 'install': {
        const { plan, ...rest } = await manager.install(request.source, request.fileName)
        return { ...rest, plan: planView(plan) }
      }
      case 'set-enabled':
        await manager.setEnabled(request.id, request.enabled)
        return null
      case 'uninstall':
        await manager.uninstall(request.id)
        return null
      case 'status': {
        // 用户刚在浏览器里打开"允许用户脚本"回到设置页：趁机把脚本注册上
        const { available } = await manager.reconcile()
        return { available }
      }
      default:
        throw new Error('不支持的操作')
    }
  }

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || typeof message !== 'object' || message === null) return
    const type = (message as { type?: unknown }).type
    if (type === MANAGE_MESSAGE) {
      // 只接受扩展自己的页面（设置页），不接受知乎页面里的内容脚本
      if (!sender.url?.startsWith(browser.runtime.getURL('/' as never))) return
      handleManage((message as { request: ManageRequest }).request).then(
        value => sendResponse({ ok: true, value } satisfies ManageReply<unknown>),
        e =>
          sendResponse({
            ok: false,
            error: errorMessage(e),
            ...(e instanceof InstallError ? { problems: e.problems } : {}),
          } satisfies ManageReply<unknown>),
      )
      return true
    }
    if (type === FETCH_MESSAGE) {
      proxyFetch(
        {
          index: () => readIndex(api),
          hasPermission: origins => browser.permissions.contains({ origins }),
          fetch: (input, init) => fetch(input, init),
        },
        message as FetchRequest,
      ).then(
        value => sendResponse({ ok: true, value } satisfies Reply<unknown>),
        e => sendResponse({ ok: false, error: errorMessage(e) } satisfies Reply<unknown>),
      )
      return true
    }
    return
  })

  return manager
}
