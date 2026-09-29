// 页面样本采集：把当前页面脱敏之后导出，作为 fixtures（见 docs/fixtures.md）。
// 知乎改版之后，用同一个工具重新采集，fixtures 测试就能指出适配层哪里对不上。
//
// 脱敏的做法是"白名单"：不是复制页面再删东西，而是按白名单重新生成一份 HTML，
// 没有列入白名单的属性、元素、文字一律不进入样本。
// - 文字换成同样长度的占位符（汉字→"文"、字母→"x"、数字→"0"），只保留少数固定的界面文案（如"收起"）；
// - 内容 id、用户主页标识用编号替换，同一个 id 在整份样本里编号一致（页面元素与实体仓库的对应关系保留）；
// - 链接只保留知乎站内的路径形状，不带查询参数；外站链接换成占位；
// - 图片地址、图片说明、样式、输入框的值、无障碍文字、跟踪用的 data-* 属性都不保留；
// - 类名保留（包括 css-xxxxxx 这类自动生成的类名：结构信息，也用来验证适配层没有依赖它们）；
// - 记录一部分元素的位置和大小（data-rect），布局识别的测试用。
// 用户在面板里看过样本之后自己决定是否分享；扩展不会上传。

import type { PageInfo, PageType } from '@zhihu-browser/sdk'
import { COMMENT_SELECTOR, CONTENT_SELECTOR, containerOf, isContentElement } from './dom/anchors'
import { findColumns } from './dom/layout'

export const SNAPSHOT_FORMAT = 1

/** 采集时适配层的观察结果，fixtures 测试据此检查（采集的人看过之后可以手工改） */
export interface SnapshotExpect {
  /** 样本里的内容元素数量 */
  contents?: number
  /** 样本里能对应到实体仓库的评论元素数量 */
  comments?: number
  /** 能按位置找到两栏布局的右侧栏 */
  columns?: boolean
}

export interface PageSnapshot {
  format: typeof SNAPSHOT_FORMAT
  /** 采集时的扩展版本 */
  version?: string
  /** 脱敏后的网址：域名和路径形状，id 已换成编号，不含查询参数 */
  url: string
  viewport: { width: number; height: number }
  /** <html> 和 <body> 上保留下来的属性 */
  root: Record<string, string>
  body: Record<string, string>
  /** <body> 里面的 HTML，拼在一起就是完整的一份（分成多段只是为了让文件好读、好比较） */
  html: string[]
  /** 采集时实体仓库里有的内容和评论，键是 'answer:编号'、'comment:编号' */
  entities: string[]
  expect: SnapshotExpect
  /** 采集的人写的备注（可以为空） */
  note?: string
}

export interface SnapshotOptions {
  page: PageInfo
  version?: string
  /** 实体仓库里有的键：内容是 'answer:123'，评论是 'comment:123' */
  entities?: Iterable<string>
  /** 最多保留多少块内容元素，多出来的连同外层卡片一起去掉 */
  maxContents?: number
  /** 最多保留多少条评论元素 */
  maxComments?: number
}

const DEFAULT_MAX_CONTENTS = 12
const DEFAULT_MAX_COMMENTS = 24
/** 记录位置的元素，每一层最多列出多少个兄弟 */
const MAX_RECT_SIBLINGS = 12

/** 不进入样本的元素（连同内部） */
const DROP_TAGS = new Set([
  'script',
  'style',
  'link',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'head',
  'title',
  'base',
  'picture',
  'source',
  'track',
  'audio',
])
/** 只保留元素本身，内部不进入样本 */
const OPAQUE_TAGS = new Set(['svg', 'math', 'video', 'canvas', 'textarea', 'select', 'option'])
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'col', 'wbr'])
/** 布尔属性：写成没有值的形式 */
const BOOLEAN_ATTRS = new Set(['itemscope', 'hidden'])

/** 固定的界面文案：原样保留（适配层会读"收起"这类按钮文字，而且它们不可能识别出任何人） */
const UI_WORDS = new Set([
  '阅读全文',
  '收起',
  '展开',
  '展开阅读全文',
  '赞同',
  '已赞同',
  '反对',
  '评论',
  '添加评论',
  '分享',
  '收藏',
  '喜欢',
  '感谢',
  '关注',
  '已关注',
  '关注问题',
  '写回答',
  '邀请回答',
  '举报',
  '更多',
  '查看全部',
  '首页',
  '知学堂',
  '热榜',
  '推荐',
  '回答',
  '文章',
  '想法',
  '视频',
  '全部',
  '综合',
  '用户',
  '专栏',
  '话题',
  '默认',
  '最新',
  '最热',
  '回复',
  '条评论',
  '个回答',
  '知乎',
])

/** 路径里可以原样保留的固定段（其余的段换成编号） */
const STATIC_SEGMENTS = new Set([
  'question',
  'questions',
  'answer',
  'answers',
  'p',
  'people',
  'org',
  'topic',
  'topics',
  'collection',
  'collections',
  'column',
  'columns',
  'pin',
  'pins',
  'zvideo',
  'zvideos',
  'video',
  'videos',
  'search',
  'hot',
  'follow',
  'explore',
  'signin',
  'signup',
  'notifications',
  'messages',
  'creator',
  'write',
  'settings',
  'api',
  'posts',
  'asks',
  'following',
  'followers',
  'activities',
  'special',
  'roundtable',
  'education',
  'xen',
  'market',
  'ring',
  'app',
  'terms',
  'about',
  'topstory',
  'feed',
  'recommend',
  'comment',
  'comments',
])
/** 这些段后面跟的是用户或专栏的标识，不是固定段 */
const TOKEN_AFTER = new Set(['people', 'org', 'column', 'columns'])

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** 文字的占位形状：汉字→文，数字→0，其他字母→x；标点和空白不变 */
export function shape(text: string): string {
  return text.replace(/[\p{L}\p{N}]/gu, ch => (/\p{N}/u.test(ch) ? '0' : /\p{Script=Han}/u.test(ch) ? '文' : 'x'))
}

/** 一段文字的脱敏：按空白分词，固定的界面文案原样保留，其余换成占位形状 */
export function scrubText(text: string): string {
  return text.replace(/\S+/g, token => (UI_WORDS.has(token) ? token : shape(token)))
}

/** 编号器：同一个原值在一份样本里总是得到同一个编号 */
class Numbering {
  private readonly map = new Map<string, number>()
  constructor(private readonly start: number) {}
  get(raw: string): number {
    let n = this.map.get(raw)
    if (n === undefined) {
      n = this.start + this.map.size
      this.map.set(raw, n)
    }
    return n
  }
}

/** 脱敏器：一份样本一个实例，保证编号前后一致 */
export class Scrubber {
  private readonly ids = new Numbering(100_001)
  private readonly tokens = new Numbering(1)
  private readonly names = new Numbering(1)
  private readonly segments = new Numbering(1)

  /** 内容或评论的 id：纯数字的还是纯数字，其他的（哈希）换成 k+编号 */
  id(raw: string): string {
    if (!raw) return ''
    const n = this.ids.get(raw)
    return /^\d+$/.test(raw) ? String(n) : `k${n}`
  }

  /** 实体仓库的键 'answer:123' → 'answer:编号' */
  entityKey(key: string): string {
    const i = key.indexOf(':')
    return i < 0 ? this.id(key) : `${key.slice(0, i)}:${this.id(key.slice(i + 1))}`
  }

  url(raw: string): string {
    const value = raw.trim()
    if (!value) return ''
    if (value.startsWith('#')) return '#'
    let u: URL
    try {
      u = new URL(value, 'https://www.zhihu.com/')
    } catch {
      return ''
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    if (!/(?:^|\.)zhihu\.com$/.test(u.hostname)) return 'https://external.invalid/'
    let prev = ''
    const path = u.pathname
      .split('/')
      .map(seg => {
        const keep = this.segment(seg, prev)
        prev = seg.toLowerCase()
        return keep
      })
      .join('/')
    return `https://${u.hostname}${path}`
  }

  private segment(seg: string, prev: string): string {
    if (!seg) return ''
    if (/^\d+$/.test(seg)) return this.id(seg)
    if (TOKEN_AFTER.has(prev)) return `user-${this.tokens.get(seg)}`
    const lower = seg.toLowerCase()
    if (STATIC_SEGMENTS.has(lower) || /^v\d+$/.test(lower)) return lower
    return `seg-${this.segments.get(seg)}`
  }

  /** data-zop：只保留 type，作者名、标题、id 都换掉 */
  zop(raw: string): string | undefined {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      return undefined
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
    const zop = data as Record<string, unknown>
    const out: Record<string, unknown> = {}
    if (typeof zop.authorName === 'string') out.authorName = `用户${this.names.get(zop.authorName)}`
    if (typeof zop.itemId === 'number') out.itemId = Number(this.id(String(zop.itemId)))
    else if (typeof zop.itemId === 'string') out.itemId = this.id(zop.itemId)
    if (typeof zop.title === 'string') out.title = shape(zop.title)
    if (typeof zop.type === 'string' && /^[a-z]{1,16}$/.test(zop.type)) out.type = zop.type
    return JSON.stringify(out)
  }

  /** <meta itemprop="..." content="..."> 的内容 */
  meta(prop: string, content: string): string {
    if (/url$/i.test(prop) || prop === 'mainEntityOfPage') return this.url(content)
    // 日期只保留到天
    if (/^date/i.test(prop)) {
      const t = Date.parse(content)
      return Number.isNaN(t) ? '' : `${new Date(t).toISOString().slice(0, 10)}T00:00:00.000Z`
    }
    if (/count$/i.test(prop) && /^\d{1,9}$/.test(content)) return content
    return shape(content)
  }

  /** 保留下来的属性，按元素上的顺序 */
  attributes(el: Element): [string, string][] {
    const out: [string, string][] = []
    const tag = el.localName
    const isMeta = tag === 'meta'
    for (const a of el.attributes) {
      const name = a.name.toLowerCase()
      const value = a.value
      let keep: string | undefined
      switch (name) {
        case 'class': {
          // 8 位以上的连续数字可能是 id，整个类名不保留
          const kept = value.split(/\s+/).filter(c => /^[\w-]{1,48}$/.test(c) && !/\d{8}/.test(c))
          if (kept.length) keep = kept.join(' ')
          break
        }
        case 'id':
          if (/^[A-Za-z][A-Za-z_-]{0,30}$/.test(el.id)) keep = value
          break
        case 'itemprop':
          if (/^[\w:-]{1,40}$/.test(value)) keep = value
          break
        case 'itemtype':
          if (/^https?:\/\/schema\.org\/\w{1,40}$/.test(value)) keep = value
          break
        case 'role':
          if (/^[a-z-]{1,20}$/.test(value)) keep = value
          break
        case 'type':
          if (/^[a-z-]{1,16}$/.test(value) && (tag === 'button' || tag === 'input')) keep = value
          break
        case 'data-theme':
          if (/^[a-z-]{1,16}$/.test(value)) keep = value
          break
        case 'href':
          if (tag === 'a') keep = this.url(value) || undefined
          break
        case 'content':
          if (isMeta) keep = this.meta(el.getAttribute('itemprop') ?? '', value)
          break
        case 'data-zop':
          keep = this.zop(value)
          break
        case 'data-id':
          keep = this.id(value) || undefined
          break
        case 'itemscope':
        case 'hidden':
          keep = ''
          break
      }
      if (keep !== undefined) out.push([name, keep])
    }
    return out
  }
}

function serializeAttrs(pairs: [string, string][]): string {
  return pairs.map(([n, v]) => (BOOLEAN_ATTRS.has(n) ? ` ${n}` : ` ${n}="${escAttr(v)}"`)).join('')
}

/** 内容元素之外，还要记录位置的元素：从内容一路往上的每一层，以及这一层的兄弟 */
function rectTargets(body: Element, contents: Element[]): Set<Element> {
  const targets = new Set<Element>([body])
  for (const content of contents) {
    for (let e: Element | null = content; e && e !== body; e = e.parentElement) {
      targets.add(e)
      let listed = 0
      for (const sibling of e.parentElement?.children ?? []) {
        if (listed++ >= MAX_RECT_SIBLINGS) break
        targets.add(sibling)
      }
    }
  }
  return targets
}

function rectText(el: Element, win: Window): string {
  const r = el.getBoundingClientRect()
  const n = (v: number) => Math.round(v)
  return `${n(r.left + win.scrollX)},${n(r.top + win.scrollY)},${n(r.width)},${n(r.height)}`
}

/** 采集当前页面的脱敏样本 */
export function snapshotPage(doc: Document, options: SnapshotOptions): PageSnapshot {
  const win = doc.defaultView as Window
  const scrub = new Scrubber()
  const body = doc.body
  const maxContents = options.maxContents ?? DEFAULT_MAX_CONTENTS
  const maxComments = options.maxComments ?? DEFAULT_MAX_COMMENTS
  const known = new Set(options.entities ?? [])

  // 超过上限的内容和评论：连同外层卡片一起去掉
  const skip = new Set<Element>()
  const kept: HTMLElement[] = []
  for (const el of body.querySelectorAll<HTMLElement>(CONTENT_SELECTOR)) {
    if (!isContentElement(el) || skip.has(el) || [...skip].some(s => s.contains(el))) continue
    if (kept.length < maxContents) kept.push(el)
    else skip.add(containerOf(el))
  }
  const comments: Element[] = []
  for (const el of body.querySelectorAll(COMMENT_SELECTOR)) {
    const id = el.getAttribute('data-id')
    if (!id || !known.has(`comment:${id}`) || el.matches(CONTENT_SELECTOR)) continue
    if ([...skip].some(s => s.contains(el))) continue
    if (comments.length < maxComments) comments.push(el)
    else skip.add(el)
  }

  // 位置：内容和评论元素往上的每一层
  const targets = rectTargets(body, [...kept, ...comments])
  const first = kept.find(el => !el.matches('.QuestionHeader'))
  // 右侧栏被主题隐藏时位置已经没有了：只在找得到的时候记录，找不到就不写（测试不检查）
  const columns = !!first && (!!doc.querySelector('[data-zb-columns]') || !!findColumns(first))

  const chunks: string[] = []
  const write = (el: Element): void => {
    if (skip.has(el) || el.hasAttribute('data-zb-ui')) return
    const tag = el.localName
    if (DROP_TAGS.has(tag)) return
    const pairs = scrub.attributes(el)
    if (tag === 'meta' && !pairs.some(([n]) => n === 'itemprop')) return
    if (targets.has(el)) pairs.push(['data-rect', rectText(el, win)])
    const open = `<${tag}${serializeAttrs(pairs)}>`
    if (VOID_TAGS.has(tag)) {
      chunks.push(open)
      return
    }
    chunks.push(open)
    if (!OPAQUE_TAGS.has(tag)) {
      for (const node of el.childNodes) {
        if (node.nodeType === 3) chunks.push(escText(scrubText(node.nodeValue ?? '')))
        else if (node.nodeType === 1) write(node as Element)
      }
    }
    chunks.push(`</${tag}>`)
  }
  for (const node of body.childNodes) {
    if (node.nodeType === 3) chunks.push(escText(scrubText(node.nodeValue ?? '')))
    else if (node.nodeType === 1) write(node as Element)
  }

  const attrMap = (el: Element): Record<string, string> => {
    const pairs = scrub.attributes(el)
    if (el === body) pairs.push(['data-rect', rectText(el, win)])
    return Object.fromEntries(pairs)
  }

  const html = chunks.join('')
  const expect: SnapshotExpect = { contents: kept.length, ...(known.size ? { comments: comments.length } : {}) }
  if (columns) expect.columns = true

  const url = scrub.url(options.page.url)
  return {
    format: SNAPSHOT_FORMAT,
    ...(options.version ? { version: options.version } : {}),
    url,
    viewport: { width: win.innerWidth, height: win.innerHeight },
    root: attrMap(doc.documentElement),
    body: attrMap(body),
    // 在相邻标签之间断开：拼起来和原来完全一样
    html: html.split(/(?<=>)(?=<)/),
    entities: [...new Set([...known].map(k => scrub.entityKey(k)))].sort(),
    expect,
  }
}

const ALLOWED_ATTRS = new Set([
  'class',
  'id',
  'itemprop',
  'itemtype',
  'role',
  'type',
  'data-theme',
  'href',
  'content',
  'data-zop',
  'data-id',
  'itemscope',
  'hidden',
  'data-rect',
])
const ZHIHU_URL = /^(?:#|https:\/\/(?:[a-z0-9-]+\.)*zhihu\.com(?:\/[^?#\s]*)?|https:\/\/external\.invalid\/)$/
/** 脱敏之后文字只剩占位符和标点符号 */
const SHAPE_ONLY = /^[文x0\s\p{P}\p{S}\p{M}\p{Cf}]*$/u
const DATE_ONLY = /^\d{4}-\d\d-\d\dT00:00:00\.000Z$/
const ID_LIKE = /^(?:\d+|k\d+)$/

/**
 * 检查样本是不是真的脱敏了：不看生成的过程，只看结果——属性都在白名单里，链接只有站内路径形状，
 * 文字只剩占位符和固定的界面文案。脱敏代码有漏洞时，这里是最后一道关；返回发现的问题，没有问题时是空数组。
 */
export function auditSnapshot(doc: Document, snapshot: PageSnapshot): string[] {
  const problems = new Set<string>()
  const bad = (what: string) => problems.add(what)
  const checkAttr = (owner: string, name: string, value: string): void => {
    if (!ALLOWED_ATTRS.has(name)) {
      bad(`${owner} 有不该保留的属性 ${name}`)
      return
    }
    switch (name) {
      case 'href':
        if (!ZHIHU_URL.test(value)) bad(`${owner} 的链接没有脱敏`)
        break
      case 'content':
        if (!(SHAPE_ONLY.test(value) || ZHIHU_URL.test(value) || DATE_ONLY.test(value) || /^\d{1,9}$/.test(value)))
          bad(`${owner} 的 content 没有脱敏`)
        break
      case 'data-zop': {
        let zop: Record<string, unknown> = {}
        try {
          zop = JSON.parse(value)
        } catch {
          bad(`${owner} 的 data-zop 不是 JSON`)
        }
        for (const [k, v] of Object.entries(zop)) {
          const ok =
            (k === 'authorName' && typeof v === 'string' && /^用户\d+$/.test(v)) ||
            (k === 'itemId' && ID_LIKE.test(String(v))) ||
            (k === 'title' && typeof v === 'string' && SHAPE_ONLY.test(v)) ||
            (k === 'type' && typeof v === 'string' && /^[a-z]{1,16}$/.test(v))
          if (!ok) bad(`${owner} 的 data-zop.${k} 没有脱敏`)
        }
        break
      }
      case 'data-id':
        if (!ID_LIKE.test(value)) bad(`${owner} 的 data-id 没有编号`)
        break
      case 'data-rect':
        if (!/^-?\d+,-?\d+,\d+,\d+$/.test(value)) bad(`${owner} 的 data-rect 写法不对`)
        break
      case 'id':
        if (!/^[A-Za-z][A-Za-z_-]{0,30}$/.test(value)) bad(`${owner} 的 id 可能含有内容标识`)
        break
      case 'class':
        if (value.split(/\s+/).some(c => !/^[\w-]{1,48}$/.test(c) || /\d{8}/.test(c)))
          bad(`${owner} 的类名可能含有内容标识`)
        break
    }
  }

  if (!ZHIHU_URL.test(snapshot.url) || /[?#]/.test(snapshot.url)) bad('网址没有脱敏')
  for (const key of snapshot.entities) if (!/^[a-z]+:(?:\d+|k\d+)$/.test(key)) bad('实体键没有编号')
  for (const [n, v] of Object.entries(snapshot.root)) checkAttr('<html>', n, v)
  for (const [n, v] of Object.entries(snapshot.body)) checkAttr('<body>', n, v)

  const template = doc.createElement('template')
  template.innerHTML = snapshot.html.join('')
  for (const el of template.content.querySelectorAll('*')) {
    for (const a of el.attributes) checkAttr(`<${el.localName}>`, a.name, a.value)
  }
  const texts = doc.createTreeWalker(template.content, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    for (const token of (node.nodeValue ?? '').match(/\S+/g) ?? []) {
      if (!UI_WORDS.has(token) && !SHAPE_ONLY.test(token)) bad('页面上的文字没有脱敏')
    }
  }
  return [...problems].slice(0, 20)
}

/** 样本的文本（JSON） */
export function stringifySnapshot(snapshot: PageSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

/** 下载时用的文件名：页面类型 + 序号，不含任何内容标识 */
export function snapshotFileName(type: PageType): string {
  return `zhihu-browser-sample-${type}.json`
}
