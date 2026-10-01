// 官方插件"高清原图"：正文里的图片换成原图，点击在页面上层查看大图。
// 知乎正文里的图片默认是缩小过的（_720w 之类），原图在 data-original 里；没有时按文件名的后缀规则推出原图地址。
// 只改 *.zhimg.com 的 https 图片地址，不会把图片指到别的站点。
//
// 用了 ctx.el（原始 DOM，unstable）：正文里的图片是知乎渲染的，没有别的办法拿到。

import type { ContentContext, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'hd-images',
  name: '高清原图',
  version: '0.1.0',
  api: 1,
  description: '正文图片使用原图，点击查看大图',
  settings: {
    original: {
      type: 'boolean',
      label: '使用原图',
      default: true,
      description: '关闭后保持知乎原来的缩略图；原图更清晰，但流量和加载时间也更多',
    },
    viewer: {
      type: 'boolean',
      label: '点击查看大图',
      default: true,
      description: '用本插件的大图查看器代替知乎自带的：Esc 或点击空白处关闭，← → 切换，点击图片放大到原始尺寸',
    },
  },
} satisfies PluginMeta

/** 知乎图片服务器：*.zhimg.com */
export function isZhimg(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'zhimg.com' || u.hostname.endsWith('.zhimg.com'))
  } catch {
    return false
  }
}

/** 文件名末尾的尺寸后缀：_720w、_b、_hd、_xl 等，原图是 _r */
const SIZE_SUFFIX = /_(?:\d+w|\d+x\d+|xs|s|m|l|xl|b|hd|qhd|fhd)(\.[A-Za-z0-9]+)(?=$|[?#])/

/** 一张图片的原图地址；不是知乎的图片、已经是原图、或者推不出来时返回 undefined */
export function originalUrl(img: { getAttribute(name: string): string | null }): string | undefined {
  const declared = img.getAttribute('data-original')
  if (declared && isZhimg(declared)) return declared
  const current = img.getAttribute('data-actualsrc') || img.getAttribute('src')
  if (!current || !isZhimg(current) || !SIZE_SUFFIX.test(current)) return undefined
  return current.replace(SIZE_SUFFIX, '_r$1')
}

interface Viewer {
  open(images: HTMLImageElement[], index: number): void
  close(): void
}

const VIEWER_CSS = `
.backdrop {
  position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.88); overflow: auto; cursor: zoom-out;
}
.backdrop.zoomed { display: block; }
.backdrop img { max-width: 96vw; max-height: 96vh; object-fit: contain; cursor: zoom-in; }
.backdrop.zoomed img { max-width: none; max-height: none; cursor: zoom-out; }
.count { position: fixed; bottom: 16px; left: 0; right: 0; text-align: center; color: #fff; font: 13px sans-serif; pointer-events: none; }
`

function createViewer(z: PluginAPI<typeof meta>): Viewer {
  let close: (() => void) | undefined
  const viewer: Viewer = {
    open(images, index) {
      viewer.close()
      let current = index
      close = z.ui.mount('overlay', container => {
        const doc = container.ownerDocument
        const style = doc.createElement('style')
        style.textContent = VIEWER_CSS
        const backdrop = doc.createElement('div')
        backdrop.className = 'backdrop'
        const img = doc.createElement('img')
        const count = doc.createElement('div')
        count.className = 'count'
        backdrop.append(img)
        container.append(style, backdrop, count)

        const show = (i: number) => {
          current = (i + images.length) % images.length
          const source = images[current]
          img.src = (source && (originalUrl(source) ?? source.currentSrc)) || ''
          backdrop.classList.remove('zoomed')
          count.textContent = images.length > 1 ? `${current + 1} / ${images.length}` : ''
        }
        show(current)

        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') viewer.close()
          else if (e.key === 'ArrowRight') show(current + 1)
          else if (e.key === 'ArrowLeft') show(current - 1)
          else return
          e.preventDefault()
          e.stopPropagation()
        }
        doc.addEventListener('keydown', onKey, true)
        backdrop.addEventListener('click', e => {
          if (e.target === img) backdrop.classList.toggle('zoomed')
          else viewer.close()
        })
        return () => doc.removeEventListener('keydown', onKey, true)
      })
    },
    close() {
      close?.()
      close = undefined
    },
  }
  return viewer
}

/** 正文区域里的图片（头像、表情、链接卡片里的图片不算） */
function bodyImages(root: ParentNode): HTMLImageElement[] {
  return [...root.querySelectorAll<HTMLImageElement>('.RichContent img, .RichText img, .Post-RichText img')].filter(
    img => !img.closest('a, button') && !img.classList.contains('Avatar'),
  )
}

export default function hdImages(z: PluginAPI<typeof meta>) {
  /** 被我们改过地址的图片 → 原来的地址（停用时恢复） */
  const changed = new Map<HTMLImageElement, { src: string; srcset: string | null }>()
  const viewer = createViewer(z)

  function upgrade(img: HTMLImageElement): void {
    const url = originalUrl(img)
    if (!url || img.getAttribute('src') === url) return
    if (!changed.has(img)) changed.set(img, { src: img.getAttribute('src') ?? '', srcset: img.getAttribute('srcset') })
    img.removeAttribute('srcset')
    img.setAttribute('src', url)
  }

  function restore(): void {
    for (const [img, original] of changed) {
      img.setAttribute('src', original.src)
      if (original.srcset !== null) img.setAttribute('srcset', original.srcset)
    }
    changed.clear()
  }

  const processors = new Set<() => void>()

  z.on('content', (_content, ctx: ContentContext) => {
    const el = ctx.el
    const run = () => {
      if (!z.settings.get('original')) return
      for (const img of bodyImages(el)) upgrade(img)
    }
    processors.add(run)
    run()
    // 展开全文、知乎延迟加载图片时，正文里会出现新的图片或改变图片的地址
    const observer = new MutationObserver(run)
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-original', 'data-actualsrc'],
    })

    const onClick = (e: MouseEvent) => {
      if (!z.settings.get('viewer') || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
      const target = e.target
      if (!(target instanceof Element)) return
      const images = bodyImages(el)
      const index = images.indexOf(target as HTMLImageElement)
      if (index < 0) return
      // 知乎自己的大图查看器也在监听这次点击：拦下来，只留一个
      e.preventDefault()
      e.stopPropagation()
      viewer.open(images, index)
    }
    el.addEventListener('click', onClick, true)

    ctx.signal.addEventListener(
      'abort',
      () => {
        observer.disconnect()
        el.removeEventListener('click', onClick, true)
        processors.delete(run)
      },
      { once: true },
    )
  })

  z.settings.onChange(changedSettings => {
    if ('original' in changedSettings) {
      if (changedSettings.original) for (const run of processors) run()
      else restore()
    }
    if ('viewer' in changedSettings && !changedSettings.viewer) viewer.close()
  })

  z.on('page', () => viewer.close())

  return () => {
    viewer.close()
    restore()
  }
}
