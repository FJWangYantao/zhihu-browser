import { createHost, createMemorySettingsBackend, createMemoryStorageBackend } from '@zhihu-browser/core'
import type { Answer, Article, ContentHandle, PageInfo } from '@zhihu-browser/sdk'
import { afterEach, describe, expect, test } from 'vitest'
import * as plugin from '../src/index'
import { formatDay, readerCss, sanitizeHtml } from '../src/index'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('清理正文', () => {
  const clean = (html: string) => {
    const box = document.createElement('div')
    box.append(sanitizeHtml(html))
    return box
  }

  test('保留正常的正文结构', () => {
    const box = clean(
      '<p>段落 <b>加粗</b></p><blockquote>引用</blockquote><pre><code>x = 1</code></pre><figure><img src="https://pica.zhimg.com/a.jpg"><figcaption>图</figcaption></figure>',
    )
    expect(box.querySelector('b')?.textContent).toBe('加粗')
    expect(box.querySelector('blockquote')).not.toBeNull()
    expect(box.querySelector('pre code')?.textContent).toBe('x = 1')
    expect(box.querySelector('figcaption')?.textContent).toBe('图')
  })

  test('去掉脚本、框架、表单等元素', () => {
    const box = clean(
      '<p>x</p><script>alert(1)</script><iframe></iframe><style>*{}</style><form><input></form><object></object><embed><link rel="stylesheet"><noscript>n</noscript><button>b</button>',
    )
    expect(box.innerHTML).toBe('<p>x</p>')
  })

  test('去掉事件属性和内联样式', () => {
    const box = clean(
      '<p onclick="x()" style="position:fixed" id="a">t</p><img src="https://pica.zhimg.com/a.jpg" onerror="x()">',
    )
    const p = box.querySelector('p')
    expect(p?.getAttribute('onclick')).toBeNull()
    expect(p?.getAttribute('style')).toBeNull()
    expect(p?.getAttribute('id')).toBe('a')
    expect(box.querySelector('img')?.getAttribute('onerror')).toBeNull()
  })

  test('链接：危险协议去掉，外部链接在新标签页打开且不带来源', () => {
    const box = clean(
      '<a href="javascript:alert(1)">a</a><a href="data:text/html,x">b</a><a href="https://example.com/x">c</a><a href="/people/x">d</a>',
    )
    const [a, b, c, d] = [...box.querySelectorAll('a')]
    expect(a?.hasAttribute('href')).toBe(false)
    expect(b?.hasAttribute('href')).toBe(false)
    expect(c?.getAttribute('target')).toBe('_blank')
    expect(c?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(d?.getAttribute('href')).toBe('/people/x')
  })

  test('图片：延迟加载的换成真实地址，危险的地址去掉，不带来源', () => {
    const box = clean(
      '<img src="data:image/svg+xml;utf8,<svg/>" data-original="https://pica.zhimg.com/v2-a_r.jpg">' +
        '<img src="javascript:x()"><img src="data:text/html,x"><img src="https://pica.zhimg.com/b.jpg" srcset="x 2x">',
    )
    const imgs = [...box.querySelectorAll('img')]
    expect(imgs[0]?.getAttribute('src')).toBe('https://pica.zhimg.com/v2-a_r.jpg')
    expect(imgs[1]?.hasAttribute('src')).toBe(false)
    expect(imgs[2]?.hasAttribute('src')).toBe(false)
    expect(imgs[3]?.hasAttribute('srcset')).toBe(false)
    expect(imgs[3]?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(imgs[3]?.getAttribute('loading')).toBe('lazy')
  })
})

describe('样式', () => {
  const base = { fontSize: 20, width: 800, font: 'serif', theme: 'light' } as const

  test('字号、宽度、字体、配色', () => {
    const css = readerCss(base)
    expect(css).toContain('font: 20px/1.9')
    expect(css).toContain('max-width: 800px')
    expect(css).toContain('Songti SC')
    expect(css).toContain('--bg: #ffffff')
    expect(readerCss({ ...base, theme: 'sepia' })).toContain('--bg: #f4ecd8')
    expect(readerCss({ ...base, font: 'sans' })).toContain('PingFang SC')
  })

  test('跟随系统：浅色为底，系统是暗色时换成暗色', () => {
    const css = readerCss({ ...base, theme: 'auto' })
    expect(css).toContain('--bg: #ffffff')
    expect(css).toMatch(/prefers-color-scheme: dark\) \{ \.reader \{ --bg: #16181b/)
  })

  test('日期按本地时间', () => {
    expect(formatDay(new Date(2024, 4, 1, 13, 45).getTime())).toBe('2024-05-01')
  })
})

// ---------- 插件 ----------

const answer = (overrides: Partial<Answer> = {}): Answer => ({
  type: 'answer',
  id: '1',
  url: 'https://www.zhihu.com/question/9/answer/1',
  title: '一个问题',
  question: { id: '9', title: '一个问题' },
  author: { id: 'u1', name: '某作者' },
  createdAt: new Date(2024, 4, 1).getTime(),
  wordCount: 1234,
  html: '<p>回答正文</p><script>alert(1)</script>',
  ...overrides,
})

const page = (type: PageInfo['type']): PageInfo => ({ type, url: `https://www.zhihu.com/${type}`, params: {} })

const roots: HTMLElement[] = []
afterEach(() => {
  for (const r of roots.splice(0)) r.remove()
})

function setup(current: Answer | Article | undefined, settings: Record<string, unknown> = {}) {
  const toasts: string[] = []
  const mounts: { slot: string; container: HTMLElement; disposed: boolean }[] = []
  const backend = createMemorySettingsBackend({ reader: settings })
  const handle = current ? ({ data: current } as ContentHandle) : undefined
  const host = createHost({
    services: {
      settings: backend,
      storage: createMemoryStorageBackend(),
      fetch: async () => ({
        status: 200,
        ok: true,
        headers: {},
        text: async () => '',
        json: async () => ({}) as never,
      }),
      ui: {
        toast: m => void toasts.push(m),
        confirm: async () => true,
        mount(slot, render) {
          const record = { slot, container: document.createElement('div'), disposed: false }
          document.body.append(record.container)
          roots.push(record.container)
          mounts.push(record)
          const dispose = render(record.container)
          return () => {
            record.disposed = true
            record.container.remove()
            if (typeof dispose === 'function') dispose()
          }
        },
      },
      addStyle: () => () => {},
      contents: { all: () => (handle ? [handle] : []), current: () => handle },
      log() {},
    },
  })
  return { host, toasts, mounts, backend }
}

describe('插件', () => {
  test('命令和快捷键注册在回答、问题、文章页', async () => {
    const { host } = setup(answer())
    await host.load(plugin as never)
    expect(host.commands(page('answer')).map(c => c.id)).toEqual(['reader.toggle'])
    expect(host.commands(page('article'))).toHaveLength(1)
    expect(host.commands(page('home'))).toEqual([])
    expect(host.shortcuts().map(s => [s.keys, s.description])).toEqual([['r', '打开 / 关闭阅读模式']])
  })

  test('打开：显示标题、作者、正文（已清理），再按一次关闭', async () => {
    const { host, mounts } = setup(answer())
    await host.load(plugin as never)
    await host.runCommand('reader.toggle')
    expect(mounts).toHaveLength(1)
    expect(mounts[0]?.slot).toBe('overlay')
    const c = mounts[0]?.container as HTMLElement
    expect(c.querySelector('h1')?.textContent).toBe('一个问题')
    expect(c.querySelector('.byline')?.textContent).toBe('某作者 · 2024-05-01 · 1234 字')
    expect(c.querySelector('.body')?.innerHTML).toBe('<p>回答正文</p>')

    await host.runCommand('reader.toggle')
    expect(mounts[0]?.disposed).toBe(true)
    await host.runCommand('reader.toggle')
    expect(mounts).toHaveLength(2)
  })

  test('快捷键 r 切换', async () => {
    const { host, mounts } = setup(answer())
    await host.load(plugin as never)
    host.setPage(page('answer'))
    expect(host.runShortcut('r', page('answer'))).toBe(true)
    expect(mounts).toHaveLength(1)
  })

  test('Esc 和关闭按钮关闭阅读视图', async () => {
    const { host, mounts } = setup(answer())
    await host.load(plugin as never)
    await host.runCommand('reader.toggle')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(mounts[0]?.disposed).toBe(true)
    await host.runCommand('reader.toggle')
    mounts[1]?.container.querySelector<HTMLElement>('.close')?.click()
    expect(mounts[1]?.disposed).toBe(true)
  })

  test('没有全文时提示，不打开', async () => {
    for (const current of [undefined, answer({ html: undefined }), { ...answer(), type: 'question' } as never]) {
      const { host, toasts, mounts } = setup(current)
      await host.load(plugin as never)
      await host.runCommand('reader.toggle')
      expect(mounts).toHaveLength(0)
      expect(toasts[0]).toContain('没有可以阅读的全文')
    }
  })

  test('文章也可以读', async () => {
    const article: Article = {
      type: 'article',
      id: '2',
      url: 'https://zhuanlan.zhihu.com/p/2',
      title: '文章标题',
      html: '<p>文章正文</p>',
    }
    const { host, mounts } = setup(article)
    await host.load(plugin as never)
    await host.runCommand('reader.toggle')
    expect(mounts[0]?.container.querySelector('h1')?.textContent).toBe('文章标题')
  })

  test('切换页面时关闭', async () => {
    const { host, mounts } = setup(answer())
    await host.load(plugin as never)
    host.setPage(page('answer'))
    await flush()
    await host.runCommand('reader.toggle')
    host.setPage(page('home'))
    await flush()
    expect(mounts[0]?.disposed).toBe(true)
  })

  test('设置变化后，已打开的视图用新设置重新打开', async () => {
    const { host, mounts, backend } = setup(answer())
    await host.load(plugin as never)
    await host.runCommand('reader.toggle')
    expect(mounts[0]?.container.querySelector('style')?.textContent).toContain('font: 18px/1.9')
    backend.update('reader', { fontSize: 24 })
    await flush()
    expect(mounts[0]?.disposed).toBe(true)
    expect(mounts[1]?.container.querySelector('style')?.textContent).toContain('font: 24px/1.9')
  })

  test('停用插件时关闭视图', async () => {
    const { host, mounts } = setup(answer())
    await host.load(plugin as never)
    await host.runCommand('reader.toggle')
    host.disable('reader')
    expect(mounts[0]?.disposed).toBe(true)
  })
})
