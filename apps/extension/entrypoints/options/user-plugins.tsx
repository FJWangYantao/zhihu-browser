// 设置页的"用户插件"：安装（粘贴、文件、链接）、安装前的确认、已安装插件的管理。
//
// 安装前一定先给用户看：插件是谁写的、要访问哪些外部域名、完整源码。用户确认之前，插件的任何代码都不会执行。
// 用户插件运行在已登录的知乎页面里，能做的事和你在页面上能做的一样：提醒要说清楚。

import { useEffect, useRef, useState } from 'preact/hooks'
import type { PlanView } from '../../src/user-plugins/manager'
import type { UserPluginEntry } from '../../src/user-plugins/store'
import type { PluginClient } from './client'
import { Card } from './components'

const ACTION_LABEL = {
  install: '安装',
  update: '更新',
  downgrade: '降级',
  reinstall: '重新安装',
} as const

/** "允许用户脚本"的引导：没有打开时，用户插件不会运行 */
export function UserScriptsGuide(props: {
  client: PluginClient
  available: boolean | undefined
  onGranted?: () => void
}) {
  if (props.available !== false) return null
  if (props.client.firefox) {
    return (
      <div class="banner guide" role="note">
        <strong>用户插件需要先授予"运行用户脚本"的权限。</strong>
        <p>
          这是 Firefox 要求的：它表示你允许这个扩展运行"没有经过 Mozilla 审核的代码"。官方插件和数据包不需要这个权限。
        </p>
        <div class="actions">
          <button
            type="button"
            class="primary"
            onClick={() => {
              void props.client.requestUserScripts().then(ok => ok && props.onGranted?.())
            }}
          >
            授予权限
          </button>
        </div>
      </div>
    )
  }
  return (
    <div class="banner guide" role="note">
      <strong>用户插件需要先打开"允许用户脚本"。</strong>
      <ol>
        <li>
          <button type="button" class="link" onClick={() => props.client.openExtensionDetails()}>
            打开 zhihu-browser 的扩展详情页
          </button>
          （打不开时，把 <code>{props.client.detailsUrl}</code> 粘贴到地址栏）
        </li>
        <li>找到"允许用户脚本"，打开开关。Chrome 138 及以上、Edge 都需要这一步。</li>
        <li>回到这个页面（会自动检查）。已经打开的知乎页面里，用户插件会随即启动。</li>
      </ol>
      <p>官方插件和数据包不需要这个开关。这个开关是浏览器要求的：它表示你允许这个扩展运行"没有经过商店审核的代码"。</p>
    </div>
  )
}

interface Review {
  plan: PlanView
  source: string
  fileName?: string
}

/** 安装确认：基本信息、权限、完整源码 */
function ReviewPanel(props: { review: Review; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { plan } = props.review
  const { meta, existing } = plan
  const label = ACTION_LABEL[plan.action]
  return (
    <section class="pack-preview review" aria-label="安装确认">
      <h3>
        {label}「{meta.name}」
        <span class="version">
          {existing && plan.action !== 'reinstall' ? `${existing.meta.version} → ` : ''}
          {meta.version}
        </span>
      </h3>
      {meta.description && <p>{meta.description}</p>}
      <p class="description">
        id：{meta.id}
        {meta.author && ` · 作者：${meta.author}`}
        {meta.homepage && ` · 主页：${meta.homepage}`}
      </p>
      {plan.action === 'downgrade' && <p class="description error">这个版本比已安装的更旧。</p>}

      <h4>需要的权限</h4>
      {plan.hosts.length === 0 ? (
        <p>不访问任何外部网络。</p>
      ) : (
        <>
          <p>通过 z.fetch 访问下面的网站（浏览器会请你授权；不会携带知乎的 Cookie）：</p>
          <ul class="changes">
            {plan.hosts.map(host => (
              <li key={host}>
                <code>{host}</code>
                {plan.permissions.added.includes(host) && existing && <strong class="new"> 新增</strong>}
              </li>
            ))}
          </ul>
        </>
      )}

      <p class="warning">
        插件运行在你已登录的知乎页面里，可以读取页面上的内容，并以你的身份操作页面——和你自己在页面上能做的一样。
        请只安装来源可信、读过源码的插件。
      </p>

      <details>
        <summary>查看完整源码（{props.review.source.length} 个字符）</summary>
        <pre class="source">{props.review.source}</pre>
      </details>

      <div class="actions">
        <button type="button" class="primary" disabled={props.busy} onClick={props.onConfirm}>
          确认{label}
        </button>
        <button type="button" disabled={props.busy} onClick={props.onCancel}>
          取消
        </button>
      </div>
    </section>
  )
}

/** 开发模式的轮询间隔（毫秒） */
export const DEV_POLL_MS = 1000

export type DevStatus = { kind: 'idle' } | { kind: 'ok'; text: string } | { kind: 'error'; text: string }

/**
 * 开发模式：不断检查一个链接，文件变了就自动更新插件（热重载）。
 * 第一次安装、或者更新带来新的权限时停下来，交给用户确认；其他更新不再打扰。
 */
export async function devTick(
  client: PluginClient,
  url: string,
  last: { source?: string },
): Promise<{ status?: DevStatus; review?: { source: string; fileName: string } }> {
  let downloaded: { source: string; fileName: string }
  try {
    downloaded = await client.fetchSource(url)
  } catch (e) {
    return { status: { kind: 'error', text: `读取链接失败：${e instanceof Error ? e.message : String(e)}` } }
  }
  if (downloaded.source === last.source) return {}
  const plan = await client.manage({ op: 'plan', source: downloaded.source, fileName: downloaded.fileName })
  last.source = downloaded.source
  if (!plan.ok) return { status: { kind: 'error', text: `代码有问题：${(plan.problems ?? [plan.error]).join('；')}` } }
  if (plan.value.action === 'install' || plan.value.permissions.added.length > 0) {
    return { review: downloaded }
  }
  const installed = await client.manage({ op: 'install', source: downloaded.source, fileName: downloaded.fileName })
  if (!installed.ok) return { status: { kind: 'error', text: `更新失败：${installed.error}` } }
  const time = new Date().toTimeString().slice(0, 8)
  return { status: { kind: 'ok', text: `${time} 已热重载「${plan.value.meta.name}」${plan.value.meta.version}` } }
}

function DevWatcher(props: {
  client: PluginClient
  url: string
  intervalMs?: number
  /** 需要用户确认（第一次安装或权限变化）：交给安装确认流程 */
  onReview: (source: string, fileName: string) => void
}) {
  const [watching, setWatching] = useState(false)
  const [status, setStatus] = useState<DevStatus>({ kind: 'idle' })
  const { client, url, onReview } = props

  useEffect(() => {
    if (!watching) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const last: { source?: string } = {}
    const loop = async () => {
      const result = await devTick(client, url, last)
      if (!live) return
      if (result.status) setStatus(result.status)
      if (result.review) {
        setWatching(false)
        onReview(result.review.source, result.review.fileName)
        return
      }
      timer = setTimeout(() => void loop(), props.intervalMs ?? DEV_POLL_MS)
    }
    void loop()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [watching, client, url, onReview, props.intervalMs])

  return (
    <div class="dev-watch">
      <div class="actions">
        <button
          type="button"
          disabled={!url.trim()}
          onClick={() => {
            setStatus({ kind: 'idle' })
            setWatching(!watching)
          }}
        >
          {watching ? '停止监听' : '开发模式：监听更新'}
        </button>
        {watching && (
          <span class="description">每秒检查一次这个链接，文件变化时自动更新插件。请保持这个页面打开。</span>
        )}
      </div>
      {status.kind !== 'idle' && (
        <p class={status.kind === 'error' ? 'description error' : 'description'} role="status">
          {status.text}
        </p>
      )}
    </div>
  )
}

export interface InstallPanelHandle {
  /** 把源码放进编辑框（"编辑源码"） */
  edit(source: string, fileName?: string): void
}

/** 安装插件：粘贴 / 文件 / 链接，检查之后进入确认 */
export function InstallPanel(props: {
  client: PluginClient
  /** 安装完成（含是否需要引导用户打开开关） */
  onInstalled: (result: { name: string; action: string; scriptsAvailable: boolean; needsRefresh?: boolean }) => void
  handle?: { current: InstallPanelHandle | null }
}) {
  const { client } = props
  const [source, setSource] = useState('')
  const [fileName, setFileName] = useState<string>()
  const [url, setUrl] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [review, setReview] = useState<Review>()
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!props.handle) return
    props.handle.current = {
      edit(text, name) {
        setSource(text)
        setFileName(name)
        setReview(undefined)
        setProblems([])
        area.current?.scrollIntoView({ block: 'center' })
        area.current?.focus()
      },
    }
    return () => {
      if (props.handle) props.handle.current = null
    }
  }, [props.handle])

  async function check(text: string, name?: string) {
    setProblems([])
    setReview(undefined)
    if (!text.trim()) {
      setProblems(['请先粘贴插件代码、选择文件或输入链接'])
      return
    }
    setBusy(true)
    try {
      const reply = await client.manage({ op: 'plan', source: text, ...(name ? { fileName: name } : {}) })
      if (reply.ok) setReview({ plan: reply.value, source: text, ...(name ? { fileName: name } : {}) })
      else setProblems(reply.problems ?? [reply.error])
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!review) return
    // 请求主机权限要在点击的处理函数里直接调用：浏览器要求有用户操作
    const asked = client.requestHosts(review.plan.hostPatterns)
    setBusy(true)
    try {
      const granted = await asked
      const reply = await client.manage({
        op: 'install',
        source: review.source,
        ...(review.fileName ? { fileName: review.fileName } : {}),
      })
      if (!reply.ok) {
        setProblems(reply.problems ?? [reply.error])
        setReview(undefined)
        return
      }
      const { plan, scriptsAvailable, needsRefresh } = reply.value
      setReview(undefined)
      setSource('')
      setFileName(undefined)
      // 链接保留着：开发模式下装完马上要监听它
      props.onInstalled({
        name: plan.meta.name,
        action: ACTION_LABEL[plan.action],
        scriptsAvailable,
        needsRefresh,
      })
      if (!granted && plan.hostPatterns.length) {
        setProblems(['没有授予访问外部网站的权限：插件里的 z.fetch 会失败。可以在已安装插件的卡片里重新授权。'])
      }
    } finally {
      setBusy(false)
    }
  }

  async function fromUrl() {
    setProblems([])
    if (!url.trim()) {
      setProblems(['请输入插件文件的链接'])
      return
    }
    setBusy(true)
    try {
      const downloaded = await client.fetchSource(url.trim())
      setSource(downloaded.source)
      setFileName(downloaded.fileName)
      setBusy(false)
      await check(downloaded.source, downloaded.fileName)
    } catch (e) {
      setProblems([e instanceof Error ? e.message : String(e)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="安装用户插件"
      description="用户插件是一个 .ts 或 .js 文件，写法见插件 API 文档。可以粘贴代码、选择文件，或者从链接下载。安装之前会先让你确认权限并查看完整源码。"
    >
      <div class="fields">
        <div class="field">
          <label for="plugin-source">插件代码</label>
          <textarea
            id="plugin-source"
            ref={area}
            rows={10}
            spellcheck={false}
            class="code"
            placeholder={
              'export const meta = {\n  id: "my-plugin",\n  name: "我的插件",\n  version: "1.0.0",\n  api: 1,\n}\n\nexport default function (z) {\n  // …\n}'
            }
            value={source}
            onInput={e => {
              setSource(e.currentTarget.value)
              setFileName(undefined)
            }}
          />
        </div>
        <div class="actions">
          <button type="button" class="primary" disabled={busy} onClick={() => void check(source, fileName)}>
            检查并安装
          </button>
          <label class="file-button">
            选择文件…
            <input
              type="file"
              accept=".ts,.js,.mjs,text/javascript,text/typescript"
              onChange={e => {
                const file = e.currentTarget.files?.[0]
                e.currentTarget.value = ''
                if (!file) return
                void file.text().then(text => {
                  setSource(text)
                  setFileName(file.name)
                  void check(text, file.name)
                })
              }}
            />
          </label>
        </div>
        <div class="field">
          <label for="plugin-url">或者从链接下载</label>
          <div class="inline">
            <input
              id="plugin-url"
              type="text"
              placeholder="https://…/plugin.ts"
              value={url}
              onInput={e => setUrl(e.currentTarget.value)}
            />
            <button type="button" disabled={busy} onClick={() => void fromUrl()}>
              下载并检查
            </button>
          </div>
          <DevWatcher
            client={client}
            url={url}
            onReview={(text, name) => {
              setSource(text)
              setFileName(name)
              void check(text, name)
            }}
          />
        </div>

        {problems.length > 0 && (
          <div class="pack-preview error" role="alert">
            <p>无法安装：</p>
            <ul>
              {problems.map(problem => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}

        {review && (
          <ReviewPanel
            review={review}
            busy={busy}
            onConfirm={() => void confirm()}
            onCancel={() => setReview(undefined)}
          />
        )}
      </div>
    </Card>
  )
}

/** 已安装插件卡片下面的操作：主机权限、查看和编辑源码、卸载 */
export function UserPluginFooter(props: {
  client: PluginClient
  entry: UserPluginEntry
  onEdit: () => void
  onUninstall: () => void
  onSaved: (message: string) => void
}) {
  const { client, entry } = props
  const patterns = (entry.meta.permissions ?? []).map(p => `*://${p.slice('net:'.length)}/*`)
  const [granted, setGranted] = useState<boolean>()
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let live = true
    void client.hasHosts(patterns).then(ok => live && setGranted(ok))
    return () => {
      live = false
    }
    // 权限变化（授权、卸载）后重新检查
  }, [client, patterns.join(',')])

  return (
    <div class="user-footer">
      <p class="description">
        用户插件 · id：{entry.meta.id}
        {entry.meta.author && ` · 作者：${entry.meta.author}`}
      </p>
      {patterns.length > 0 && (
        <p class={granted ? 'description' : 'description error'}>
          访问：{(entry.meta.permissions ?? []).map(p => p.slice('net:'.length)).join('、')} ·{' '}
          {granted ? '已授权' : '尚未授权'}
          {granted === false && (
            <>
              {' '}
              <button
                type="button"
                class="link"
                onClick={() => {
                  void client.requestHosts(patterns).then(ok => {
                    setGranted(ok)
                    props.onSaved(ok ? '已授权' : '没有授权')
                  })
                }}
              >
                授权
              </button>
            </>
          )}
        </p>
      )}
      <div class="actions">
        <button type="button" class="link" onClick={props.onEdit}>
          查看 / 编辑源码
        </button>
        {confirming ? (
          <>
            <span class="description">卸载会同时删除这个插件的设置和数据。</span>
            <button type="button" class="link danger" onClick={props.onUninstall}>
              确认卸载
            </button>
            <button type="button" class="link" onClick={() => setConfirming(false)}>
              取消
            </button>
          </>
        ) : (
          <button type="button" class="link danger" onClick={() => setConfirming(true)}>
            卸载
          </button>
        )}
      </div>
    </div>
  )
}
