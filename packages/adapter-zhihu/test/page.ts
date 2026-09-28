// 集成测试的工具：在 happy-dom 里搭一个"知乎页面"，接上真实的插件宿主（core），模拟页面主环境发来的消息。

import { createHost, createMemorySettingsBackend, createMemoryStorageBackend, type Host } from '@zhihu-browser/core'
import type { PluginAPI, PluginMeta, PluginModule } from '@zhihu-browser/sdk'
import { type Message, open, TO_ISOLATED, TO_MAIN, type ToIsolated, type ToMain } from '../src/bridge'
import { type Adapter, createAdapter } from '../src/isolated'

export const flush = () => new Promise(resolve => setTimeout(resolve, 0))

export function plugin<M extends PluginMeta>(meta: M, entry: (z: PluginAPI<M>) => unknown): PluginModule {
  return { meta, default: entry as unknown as PluginModule['default'] }
}

export interface CardOptions {
  title?: string
  author?: string
  questionId?: string
  /** 不写 data-zop（模拟想法等没有 data-zop 的卡片） */
  noZop?: boolean
}

function contentUrl(type: string, id: string, questionId = '9') {
  if (type === 'answer') return `https://www.zhihu.com/question/${questionId}/answer/${id}`
  if (type === 'article') return `https://zhuanlan.zhihu.com/p/${id}`
  return `https://www.zhihu.com/${type}/${id}`
}

/** .ContentItem 元素，结构参照 M0 记录的锚点 */
export function contentItem(type: 'answer' | 'article' | 'pin', id: string, options: CardOptions = {}): string {
  const title = options.title ?? '一个问题'
  const url = contentUrl(type, id, options.questionId)
  const zop = JSON.stringify({ authorName: options.author ?? '用户1', itemId: Number(id), title, type })
  return `<div class="ContentItem ${type === 'answer' ? 'AnswerItem' : 'ArticleItem'}" ${options.noZop ? '' : `data-zop='${zop}'`} itemprop="${type}" itemscope>
  <h2 class="ContentItem-title"><a href="${url}">${title}</a></h2>
  <div itemprop="author" itemscope><meta itemprop="name" content="${options.author ?? '用户1'}"><meta itemprop="url" content="https://www.zhihu.com/people/user-1"></div>
  <meta itemprop="url" content="${url}">
  <meta itemprop="dateCreated" content="2023-11-14T22:13:20.000Z">
  <meta itemprop="upvoteCount" content="12">
  <div class="RichContent is-collapsed"><div class="RichContent-inner">正文摘要</div><button class="ContentItem-more">阅读全文</button></div>
  <div class="ContentItem-actions"><button class="Button VoteButton">赞同</button><button class="ContentItem-rightButton">收起</button></div>
</div>`
}

/** 首页推荐的一张卡片 */
export function feedCard(type: 'answer' | 'article' | 'pin', id: string, options: CardOptions = {}): string {
  return `<div class="Card TopstoryItem"><div class="Feed">${contentItem(type, id, options)}</div></div>`
}

export function listItem(type: 'answer', id: string, options: CardOptions = {}): string {
  return `<div class="List-item">${contentItem(type, id, options)}</div>`
}

export function hotItem(questionId: string, title: string): string {
  return `<section class="HotItem"><div class="HotItem-index">1</div><div class="HotItem-content"><a href="https://www.zhihu.com/question/${questionId}" title="${title}"><h2 class="HotItem-title">${title}</h2></a><p class="HotItem-excerpt">摘要</p></div></section>`
}

export function html(markup: string): HTMLElement {
  const t = document.createElement('template')
  t.innerHTML = markup.trim()
  return t.content.firstElementChild as HTMLElement
}

export interface Setup {
  adapter: Adapter
  host: Host
  settings: ReturnType<typeof createMemorySettingsBackend>
  /** 页面主环境收到的消息 */
  received: Message<ToMain>[]
  /** 模拟页面主环境转来一个接口响应，返回隔离环境的回复（没有改写时为 undefined） */
  respond(url: string, body: unknown): unknown
  send(head: ToIsolated, body?: string): void
  root: HTMLElement
  dispose(): void
}

export async function setup(
  options: {
    plugins?: PluginModule[]
    settings?: Record<string, Record<string, unknown>>
    hydrated?: boolean
    start?: boolean
  } = {},
): Promise<Setup> {
  const received: Message<ToMain>[] = []
  let lastReply: Message<ToMain> | undefined
  const main = open<ToMain, ToIsolated>(document, TO_MAIN, TO_ISOLATED, message => {
    received.push(message)
    lastReply = message
  })
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)

  const adapter = createAdapter({ hydrationTimeout: 60_000, routePollInterval: 60_000 })
  const settings = createMemorySettingsBackend(options.settings)
  const host = createHost({
    services: {
      settings,
      storage: createMemoryStorageBackend(),
      fetch: async () => {
        throw new Error('测试里不访问网络')
      },
      ui: adapter.ui,
      addStyle: css => adapter.ui.addStyle(css),
      contents: adapter.contents,
      log: () => {},
    },
  })
  for (const p of options.plugins ?? []) await host.load(p)
  if (options.start !== false) adapter.start(host)
  if (options.hydrated !== false) main.send({ type: 'hydrated' })
  await flush()

  let seq = 0
  return {
    adapter,
    host,
    settings,
    received,
    root,
    send: (head, body) => main.send(head, body),
    respond(url, body) {
      lastReply = undefined
      main.send({ type: 'response', id: ++seq, url }, JSON.stringify(body))
      const reply = lastReply as Message<ToMain> | undefined
      if (reply?.head.type !== 'reply') throw new Error('没有收到回复')
      return reply.head.changed ? JSON.parse(reply.body) : undefined
    },
    dispose() {
      adapter.dispose()
      host.dispose()
      main.close()
      document.body.replaceChildren()
      document.documentElement.removeAttribute('data-zb-prehide')
      history.replaceState(null, '', '/')
    },
  }
}
