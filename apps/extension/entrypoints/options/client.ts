// 设置页用到的浏览器能力：向后台发用户插件的管理消息、请求主机权限、下载插件源码。
// 集中在这里，设置页的界面组件只依赖 PluginClient，测试时可以替换。

import { browser } from 'wxt/browser'
import {
  MANAGE_MESSAGE,
  type ManageReplies,
  type ManageReply,
  type ManageRequest,
} from '../../src/user-plugins/messages'

export interface PluginClient {
  manage<K extends ManageRequest['op']>(
    request: Extract<ManageRequest, { op: K }>,
  ): Promise<ManageReply<ManageReplies[K]>>
  /** 请求主机权限（必须在用户点击的处理函数里直接调用，之前不能有 await） */
  requestHosts(patterns: string[]): Promise<boolean>
  hasHosts(patterns: string[]): Promise<boolean>
  removeHosts(patterns: string[]): Promise<void>
  /** 从链接下载插件源码 */
  fetchSource(url: string): Promise<{ source: string; fileName: string }>
  /** 打开这个扩展在浏览器里的详情页（"允许用户脚本"开关在那里） */
  openExtensionDetails(): void
  /** 详情页的地址（打不开时让用户自己复制） */
  detailsUrl: string
  /** Firefox：userScripts 是可选权限，要在设置页里请求（必须在用户点击的处理函数里直接调用） */
  firefox: boolean
  requestUserScripts(): Promise<boolean>
}

const MAX_DOWNLOAD_BYTES = 1024 * 1024

export function fileNameOf(url: URL): string {
  const name = url.pathname.split('/').filter(Boolean).pop() ?? 'plugin.js'
  return /\.(?:[mc]?[jt]s)$/i.test(name) ? name : `${name}.js`
}

async function download(url: string): Promise<{ source: string; fileName: string }> {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('只支持 http 和 https 链接')
  const response = await fetch(u.href, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error('文件太大（超过 1 MB）')
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) throw new Error('文件太大（超过 1 MB）')
  return { source: new TextDecoder().decode(buffer), fileName: fileNameOf(u) }
}

export function createPluginClient(): PluginClient {
  const detailsUrl = `chrome://extensions/?id=${browser.runtime.id}`
  return {
    async manage(request) {
      const reply = (await browser.runtime.sendMessage({ type: MANAGE_MESSAGE, request })) as
        | ManageReply<never>
        | undefined
      return reply ?? { ok: false, error: '后台没有响应，请重试' }
    },
    async requestHosts(patterns) {
      if (!patterns.length) return true
      try {
        return await browser.permissions.request({ origins: patterns })
      } catch {
        return false
      }
    },
    async hasHosts(patterns) {
      if (!patterns.length) return true
      try {
        return await browser.permissions.contains({ origins: patterns })
      } catch {
        return false
      }
    },
    async removeHosts(patterns) {
      if (!patterns.length) return
      try {
        await browser.permissions.remove({ origins: patterns })
      } catch {
        // 权限不存在或正在被使用：不影响卸载
      }
    },
    async fetchSource(url) {
      try {
        return await download(url)
      } catch (e) {
        // 跨域被拒绝时，请求这个站点的访问权限后再试一次（需要用户在浏览器弹窗里同意）
        if (!(e instanceof TypeError)) throw e
        const u = new URL(url)
        const granted = await browser.permissions.request({ origins: [`*://${u.hostname}/*`] }).catch(() => false)
        if (!granted) throw new Error(`无法下载：没有获得访问 ${u.hostname} 的权限`)
        return download(url)
      }
    },
    openExtensionDetails() {
      void browser.tabs.create({ url: detailsUrl }).catch(() => {})
    },
    detailsUrl,
    firefox: import.meta.env.BROWSER === 'firefox',
    async requestUserScripts() {
      try {
        return await browser.permissions.request({ permissions: ['userScripts' as never] })
      } catch {
        return false
      }
    },
  }
}
