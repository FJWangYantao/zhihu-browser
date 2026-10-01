import {
  type ContentTarget,
  createHost,
  createMemorySettingsBackend,
  createMemoryStorageBackend,
} from '@zhihu-browser/core'
import type { Answer, ContentHandle, Dispose, ItemUI } from '@zhihu-browser/sdk'
import { afterEach, describe, expect, test } from 'vitest'
import * as plugin from '../src/index'
import { isZhimg, originalUrl } from '../src/index'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const attrs = (a: Record<string, string>) => ({ getAttribute: (n: string) => a[n] ?? null })

describe('原图地址', () => {
  test('优先用 data-original', () => {
    expect(
      originalUrl(
        attrs({
          'data-original': 'https://pica.zhimg.com/v2-abc_r.jpg?source=1',
          src: 'https://pica.zhimg.com/v2-abc_720w.jpg',
        }),
      ),
    ).toBe('https://pica.zhimg.com/v2-abc_r.jpg?source=1')
  })

  test.each([
    ['https://pica.zhimg.com/v2-abc_720w.jpg?source=2c26e567', 'https://pica.zhimg.com/v2-abc_r.jpg?source=2c26e567'],
    ['https://picx.zhimg.com/v2-abc_b.png', 'https://picx.zhimg.com/v2-abc_r.png'],
    ['https://picx.zhimg.com/v2-abc_1440w.webp#x', 'https://picx.zhimg.com/v2-abc_r.webp#x'],
    ['https://picx.zhimg.com/50/v2-abc_hd.jpg', 'https://picx.zhimg.com/50/v2-abc_r.jpg'],
  ])('按后缀规则推出原图 %s', (src, expected) => {
    expect(originalUrl(attrs({ src }))).toBe(expected)
  })

  test('用 data-actualsrc（延迟加载时真正的地址）', () => {
    expect(
      originalUrl(
        attrs({ src: 'data:image/svg+xml;utf8,<svg/>', 'data-actualsrc': 'https://pic1.zhimg.com/v2-x_b.jpg' }),
      ),
    ).toBe('https://pic1.zhimg.com/v2-x_r.jpg')
  })

  test.each([
    ['已经是原图', { src: 'https://pica.zhimg.com/v2-abc_r.jpg' }],
    ['不是知乎的图片', { src: 'https://example.com/a_720w.jpg' }],
    ['不是 https', { src: 'http://pica.zhimg.com/a_720w.jpg' }],
    ['没有地址', {}],
    ['data-original 指向别的站点', { 'data-original': 'https://evil.com/a_r.jpg' }],
    ['域名只是后缀相似', { src: 'https://evilzhimg.com/a_720w.jpg' }],
  ])('%s时不改', (_name, a) => {
    expect(originalUrl(attrs(a))).toBeUndefined()
  })

  test('isZhimg', () => {
    expect(isZhimg('https://pica.zhimg.com/a.jpg')).toBe(true)
    expect(isZhimg('https://zhimg.com/a.jpg')).toBe(true)
    expect(isZhimg('https://zhimg.com.evil.com/a.jpg')).toBe(false)
    expect(isZhimg('not a url')).toBe(false)
  })
})

// ---------- 插件 ----------

const roots: HTMLElement[] = []
afterEach(() => {
  for (const r of roots.splice(0)) r.remove()
})

function setup(settings: Record<string, unknown> = {}) {
  const mounts: { slot: string; container: HTMLElement; disposed: boolean }[] = []
  const settingsBackend = createMemorySettingsBackend({ 'hd-images': settings })
  const host = createHost({
    services: {
      settings: settingsBackend,
      storage: createMemoryStorageBackend(),
      fetch: async () => ({
        status: 200,
        ok: true,
        headers: {},
        text: async () => '',
        json: async () => ({}) as never,
      }),
      ui: {
        toast() {},
        confirm: async () => true,
        mount(slot, render) {
          const record = { slot, container: document.createElement('div'), disposed: false }
          document.body.append(record.container)
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
      contents: { all: () => [], current: () => undefined },
      log() {},
    },
  })
  return { host, mounts, settingsBackend }
}

function content(html: string) {
  const el = document.createElement('div')
  el.innerHTML = `<div class="RichContent">${html}</div>`
  document.body.append(el)
  roots.push(el)
  const controller = new AbortController()
  const data: Answer = {
    type: 'answer',
    id: '1',
    url: 'https://www.zhihu.com/question/9/answer/1',
    title: 't',
    question: { id: '9', title: 't' },
  }
  const ui: ItemUI = {
    badge: () => (() => {}) as Dispose,
    fold: () => (() => {}) as Dispose,
    addAction: () => (() => {}) as Dispose,
    mount: () => (() => {}) as Dispose,
  }
  const handle = { data } as ContentHandle
  const target: ContentTarget = { el, ui, signal: controller.signal, handle }
  return { el, data, target, remove: () => controller.abort() }
}

const SMALL = 'https://pica.zhimg.com/v2-a_720w.jpg'
const ORIGINAL = 'https://pica.zhimg.com/v2-a_r.jpg'
const imgs = (el: HTMLElement) => [...el.querySelectorAll('img')].map(i => i.getAttribute('src'))

describe('插件', () => {
  test('正文图片换成原图，链接里的图片和别的站点的图片不动', async () => {
    const { host } = setup()
    await host.load(plugin as never)
    const c = content(
      `<img src="${SMALL}" data-original="${ORIGINAL}"><img src="https://pic.zhimg.com/v2-b_b.jpg"><a href="/x"><img src="${SMALL}"></a><img src="https://example.com/c_720w.jpg">`,
    )
    host.addContent(c.data, c.target)
    await flush()
    expect(imgs(c.el)).toEqual([ORIGINAL, 'https://pic.zhimg.com/v2-b_r.jpg', SMALL, 'https://example.com/c_720w.jpg'])
  })

  test('之后加载出来的图片也会处理（展开全文、延迟加载）', async () => {
    const { host } = setup()
    await host.load(plugin as never)
    const c = content('')
    host.addContent(c.data, c.target)
    await flush()
    const img = document.createElement('img')
    img.setAttribute('src', SMALL)
    c.el.querySelector('.RichContent')?.append(img)
    await flush()
    expect(imgs(c.el)).toEqual([ORIGINAL])
    // 知乎延迟加载时改 src：再次处理
    img.setAttribute('src', 'https://pica.zhimg.com/v2-z_720w.jpg')
    await flush()
    expect(imgs(c.el)).toEqual(['https://pica.zhimg.com/v2-z_r.jpg'])
  })

  test('关闭"使用原图"后恢复缩略图，再打开又换回去', async () => {
    const { host, settingsBackend } = setup()
    await host.load(plugin as never)
    const c = content(`<img src="${SMALL}" srcset="${SMALL} 1x" data-original="${ORIGINAL}">`)
    host.addContent(c.data, c.target)
    await flush()
    expect(imgs(c.el)).toEqual([ORIGINAL])
    settingsBackend.update('hd-images', { original: false })
    await flush()
    expect(imgs(c.el)).toEqual([SMALL])
    expect(c.el.querySelector('img')?.getAttribute('srcset')).toBe(`${SMALL} 1x`)
    settingsBackend.update('hd-images', { original: true })
    await flush()
    expect(imgs(c.el)).toEqual([ORIGINAL])
  })

  test('停用插件时恢复原来的图片', async () => {
    const { host } = setup()
    await host.load(plugin as never)
    const c = content(`<img src="${SMALL}">`)
    host.addContent(c.data, c.target)
    await flush()
    expect(imgs(c.el)).toEqual([ORIGINAL])
    host.disable('hd-images')
    expect(imgs(c.el)).toEqual([SMALL])
  })

  test('点击图片打开大图查看器：Esc 关闭，← → 切换，点击图片放大', async () => {
    const { host, mounts } = setup()
    await host.load(plugin as never)
    const c = content(
      `<img src="${SMALL}" data-original="${ORIGINAL}"><img src="https://pica.zhimg.com/v2-b_720w.jpg" data-original="https://pica.zhimg.com/v2-b_r.jpg">`,
    )
    host.addContent(c.data, c.target)
    await flush()
    const first = c.el.querySelectorAll('img')[0]
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    first?.dispatchEvent(click)
    // 知乎自己的查看器收不到这次点击
    expect(click.defaultPrevented).toBe(true)
    expect(mounts).toHaveLength(1)
    expect(mounts[0]?.slot).toBe('overlay')
    const shown = () => mounts[0]?.container.querySelector('.backdrop img')?.getAttribute('src')
    expect(shown()).toBe(ORIGINAL)
    expect(mounts[0]?.container.querySelector('.count')?.textContent).toBe('1 / 2')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(shown()).toBe('https://pica.zhimg.com/v2-b_r.jpg')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(shown()).toBe(ORIGINAL)

    const image = mounts[0]?.container.querySelector('.backdrop img') as HTMLElement
    image.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(mounts[0]?.container.querySelector('.backdrop')?.classList.contains('zoomed')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(mounts[0]?.disposed).toBe(true)
  })

  test('点击空白处关闭；链接里的图片、按住修饰键、关闭了查看器时不拦截', async () => {
    const { host, mounts, settingsBackend } = setup()
    await host.load(plugin as never)
    const c = content(`<img src="${SMALL}"><a href="/x"><img src="${SMALL}"></a>`)
    host.addContent(c.data, c.target)
    await flush()
    const [plain, linked] = c.el.querySelectorAll('img')

    const inLink = new MouseEvent('click', { bubbles: true, cancelable: true })
    linked?.dispatchEvent(inLink)
    expect(inLink.defaultPrevented).toBe(false)
    const withCtrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    plain?.dispatchEvent(withCtrl)
    expect(withCtrl.defaultPrevented).toBe(false)
    expect(mounts).toHaveLength(0)

    plain?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(mounts).toHaveLength(1)
    mounts[0]?.container.querySelector('.backdrop')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(mounts[0]?.disposed).toBe(true)

    settingsBackend.update('hd-images', { viewer: false })
    await flush()
    const off = new MouseEvent('click', { bubbles: true, cancelable: true })
    plain?.dispatchEvent(off)
    expect(off.defaultPrevented).toBe(false)
    expect(mounts).toHaveLength(1)
  })

  test('内容被移除后不再监听', async () => {
    const { host } = setup()
    await host.load(plugin as never)
    const c = content('')
    host.addContent(c.data, c.target)
    await flush()
    c.remove()
    const img = document.createElement('img')
    img.setAttribute('src', SMALL)
    c.el.querySelector('.RichContent')?.append(img)
    await flush()
    expect(imgs(c.el)).toEqual([SMALL])
  })
})
