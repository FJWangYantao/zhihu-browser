import type { Content, ContentContext, ItemContext, PageInfo } from '@zhihu-browser/sdk'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ASK_REACT } from '../src/bridge'
import { createAdapter } from '../src/isolated'
import { apiAnswer, apiArticle, apiComment, initialData, questionFeeds, recommend, rootComments } from './fixtures'
import { contentItem, feedCard, flush, hotItem, html, listItem, plugin, type Setup, setup } from './page'

const RECOMMEND = 'https://www.zhihu.com/api/v3/feed/topstory/recommend?desktop=true'
const meta = { id: 'p', name: 'p', version: '1.0.0', api: 1 } as const

let s: Setup | undefined
afterEach(() => {
  s?.dispose()
  s = undefined
})

const $ = (selector: string) => document.querySelector<HTMLElement>(selector)
const hidden = (el: Element | null) => !!el?.closest('[data-zb-hidden]')

describe('信息流', () => {
  test('接口响应在渲染前过滤；渲染出来的元素交给渲染钩子', async () => {
    const seen: Content[] = []
    s = await setup({
      plugins: [
        plugin(meta, z => {
          z.filter('feed', item => item.content?.type !== 'article')
          z.on('content', (c, ctx) => {
            seen.push(c)
            ctx.ui.badge('标签', { tone: 'warn', title: '说明' })
          })
        }),
      ],
    })
    const out = s.respond(RECOMMEND, recommend([apiAnswer('1'), apiArticle('2')])) as { data: unknown[] }
    expect(out.data).toHaveLength(1)
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    expect(seen.map(c => `${c.type}:${c.id}`)).toEqual(['answer:1'])
    // 数据来自接口，比页面元素上的完整
    expect(seen[0]).toMatchObject({ html: '<p>第一段</p><p>第二段 &amp; 更多</p>', wordCount: 9 })
    const item = $('.ContentItem')
    expect(item?.getAttribute('data-zb-id')).toBe('answer:1')
    expect(item?.hasAttribute('data-zb-done')).toBe(true)
    const badge = item?.querySelector('.ContentItem-title > .zb-badges > .zb-badge')
    expect(badge?.textContent).toBe('标签')
    expect(badge?.getAttribute('data-tone')).toBe('warn')
  })

  test('已经渲染的元素（如服务端渲染）在页面上隐藏', async () => {
    const seen: string[] = []
    s = await setup({
      plugins: [
        plugin(meta, z => {
          z.filter('feed', item => item.content?.type !== 'article')
          z.on('content', c => seen.push(c.id))
        }),
      ],
    })
    s.root.append(html(feedCard('article', '2')), html(feedCard('answer', '3')))
    await flush()
    expect(hidden($('[data-zb-id="article:2"]'))).toBe(true)
    expect($('.TopstoryItem')?.hasAttribute('data-zb-hidden')).toBe(true)
    expect(hidden($('[data-zb-id="answer:3"]'))).toBe(false)
    expect(seen).toEqual(['3'])
  })

  test('设置变化后重新过滤：被隐藏的恢复并交给渲染钩子，新被过滤的撤销插件界面', async () => {
    const seen: string[] = []
    const withSetting = {
      ...meta,
      settings: {
        hide: { type: 'select', label: '隐藏', default: 'article', options: { article: '文章', answer: '回答' } },
      },
    } as const
    s = await setup({
      plugins: [
        plugin(withSetting, z => {
          z.filter('feed', item => item.content?.type !== z.settings.get('hide'))
          z.on('content', (c, ctx) => {
            seen.push(c.id)
            ctx.ui.badge('看过')
          })
        }),
      ],
    })
    s.root.append(html(feedCard('article', '2')), html(feedCard('answer', '3')))
    await flush()
    expect(seen).toEqual(['3'])
    expect(document.querySelectorAll('.zb-badge')).toHaveLength(1)

    s.settings.update('p', { hide: 'answer' })
    await flush()
    expect(hidden($('[data-zb-id="article:2"]'))).toBe(false)
    expect(hidden($('[data-zb-id="answer:3"]'))).toBe(true)
    expect(seen).toEqual(['3', '2'])
    // 回答被过滤：它上面的标签撤销了，只剩文章上的
    expect(
      [...document.querySelectorAll('.zb-badge')].map(b => b.closest('[data-zb-id]')?.getAttribute('data-zb-id')),
    ).toEqual(['article:2'])
  })

  test('整页都被过滤时不删数据，渲染出来后折叠', async () => {
    const seen: string[] = []
    s = await setup({
      plugins: [
        plugin(meta, z => {
          z.filter('feed', () => false)
          z.on('content', c => seen.push(c.id))
        }),
      ],
    })
    expect(s.respond(RECOMMEND, recommend([apiAnswer('1'), apiAnswer('2')]))).toBeUndefined()
    s.root.append(html(feedCard('answer', '1')), html(feedCard('answer', '2')), html(feedCard('answer', '5')))
    await flush()
    const folded = [...document.querySelectorAll('[data-zb-fold]')].map(el => el.getAttribute('data-zb-id'))
    expect(folded).toEqual(['answer:1', 'answer:2'])
    expect($('[data-zb-id="answer:1"]')?.getAttribute('data-zb-fold')).toBe('已过滤')
    // 不在那一页里的元素照常隐藏
    expect(hidden($('[data-zb-id="answer:5"]'))).toBe(true)
    expect(seen).toEqual([])
  })

  test('没有过滤函数时不改动接口响应', async () => {
    s = await setup({ plugins: [plugin(meta, z => z.on('content', () => {}))] })
    expect(s.respond(RECOMMEND, recommend([apiAnswer('1')]))).toBeUndefined()
    expect(s.respond('https://www.zhihu.com/api/v4/me', { id: 'me' })).toBeUndefined()
    expect(s.adapter.store.hasContent('answer:1')).toBe(true)
  })
})

describe('界面工具', () => {
  test('知乎前端激活之前先排队，激活之后再插入；折叠立即生效', async () => {
    s = await setup({
      hydrated: false,
      plugins: [
        plugin(meta, z =>
          z.on('content', (_c, ctx) => {
            ctx.ui.badge('标签')
            ctx.ui.fold('太长')
            ctx.ui.addAction({ label: '按钮', onClick: () => {} })
            ctx.ui.mount('after', el => {
              el.textContent = '挂载'
            })
          }),
        ),
      ],
    })
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    const item = $('.ContentItem')
    expect(item?.getAttribute('data-zb-fold')).toBe('太长')
    expect(document.querySelectorAll('[data-zb-ui]')).toHaveLength(0)

    s.send({ type: 'hydrated' })
    expect(item?.querySelector('.zb-badge')?.textContent).toBe('标签')
    expect(item?.querySelector('.ContentItem-actions > .zb-action')?.textContent).toBe('按钮')
    const mount = item?.querySelector('.zb-mount')
    expect(mount?.previousElementSibling?.classList.contains('RichContent')).toBe(true)
    expect(mount?.shadowRoot?.textContent).toBe('挂载')
  })

  test('操作按钮：点击不会传到知乎的卡片上', async () => {
    const clicks: string[] = []
    s = await setup({
      plugins: [
        plugin(meta, z =>
          z.on('content', (_c, ctx) => ctx.ui.addAction({ label: '屏蔽', onClick: () => clicks.push('plugin') })),
        ),
      ],
    })
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    s.root.addEventListener('click', () => clicks.push('card'))
    $('.zb-action')?.click()
    expect(clicks).toEqual(['plugin'])
  })

  test('折叠：点击展开，再点顶部那一行折叠；撤销后恢复原样', async () => {
    let unfold = () => {}
    s = await setup({ plugins: [plugin(meta, z => z.on('content', (_c, ctx) => (unfold = ctx.ui.fold('原因'))))] })
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    const item = $('.ContentItem') as HTMLElement
    item.click()
    expect(item.hasAttribute('data-zb-fold-open')).toBe(true)
    // 展开后点正文不会折叠
    item.querySelector<HTMLElement>('.RichContent-inner')?.click()
    expect(item.hasAttribute('data-zb-fold-open')).toBe(true)
    item.click()
    expect(item.hasAttribute('data-zb-fold-open')).toBe(false)
    unfold()
    expect(item.hasAttribute('data-zb-fold')).toBe(false)
  })

  test('知乎重新渲染带走了插入的节点时放回去', async () => {
    s = await setup({ plugins: [plugin(meta, z => z.on('content', (_c, ctx) => ctx.ui.badge('标签')))] })
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    const title = $('.ContentItem-title') as HTMLElement
    // 模拟 React 重新渲染标题
    title.replaceChildren(document.createTextNode('新标题'))
    await flush()
    expect(title.querySelector('.zb-badge')?.textContent).toBe('标签')
  })

  test('元素被移除时中止 signal、撤销界面，不再出现在 contents 里', async () => {
    const contexts: ContentContext[] = []
    s = await setup({ plugins: [plugin(meta, z => z.on('content', (_c, ctx) => contexts.push(ctx)))] })
    s.root.append(html(feedCard('answer', '1')), html(feedCard('answer', '2')))
    await flush()
    expect(s.adapter.contents.all().map(h => h.data.id)).toEqual(['1', '2'])
    s.root.firstElementChild?.remove()
    await flush()
    expect(contexts.map(c => c.signal.aborted)).toEqual([true, false])
    expect(s.adapter.contents.all().map(h => h.data.id)).toEqual(['2'])
  })

  test('内容操作：展开全文', async () => {
    s = await setup({ plugins: [plugin(meta, z => z.on('content', (_c, ctx) => ctx.ui.fold('长')))] })
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    const more = vi.fn()
    $('.ContentItem-more')?.addEventListener('click', more)
    const handle = s.adapter.contents.all()[0]
    handle?.expand()
    expect(more).toHaveBeenCalledTimes(1)
    expect($('.ContentItem')?.hasAttribute('data-zb-fold-open')).toBe(true)
    expect(handle?.isVisible()).toBe(false)
  })

  test('内容操作：收起只点文字是"收起"的按钮', async () => {
    s = await setup()
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    const clicks: string[] = []
    const actions = $('.ContentItem-actions') as HTMLElement
    actions.insertAdjacentHTML('afterbegin', '<button class="ContentItem-rightButton">不感兴趣</button>')
    for (const b of actions.querySelectorAll('button'))
      b.addEventListener('click', () => clicks.push(b.textContent ?? ''))
    s.adapter.contents.all()[0]?.collapse()
    expect(clicks).toEqual(['收起'])
    actions.querySelector('button:last-child')?.remove()
    s.adapter.contents.all()[0]?.collapse()
    expect(clicks).toEqual(['收起'])
  })
})

describe('各类页面', () => {
  test('问题页：首屏数据和服务端渲染的回答；问题本身也交给渲染钩子', async () => {
    history.replaceState(null, '', '/question/2301')
    const script = document.createElement('script')
    script.id = 'js-initialData'
    script.type = 'text/json'
    script.textContent = JSON.stringify(initialData())
    document.body.append(
      html('<div class="QuestionHeader"><h1 class="QuestionHeader-title">首屏的问题</h1></div>'),
      html(listItem('answer', '1301', { questionId: '2301', author: '用户3' })),
      html(listItem('answer', '1302', { questionId: '2301' })),
      script,
    )
    const seen: Content[] = []
    s = await setup({
      plugins: [
        plugin(meta, z => {
          z.filter('answers', a => a.author?.name !== '用户3')
          z.on('content', c => seen.push(c))
        }),
      ],
    })
    expect(hidden($('[data-zb-id="answer:1301"]'))).toBe(true)
    expect($('[data-zb-id="answer:1301"]')?.closest('.List-item')?.hasAttribute('data-zb-hidden')).toBe(true)
    expect(seen.map(c => `${c.type}:${c.id}`)).toEqual(['question:2301', 'answer:1302'])
    expect(seen[0]).toMatchObject({ answerCount: 5 })
    // 仓库里没有 1302：数据来自页面元素
    expect(seen[1]).toMatchObject({
      url: 'https://www.zhihu.com/question/2301/answer/1302',
      author: { name: '用户1', urlToken: 'user-1' },
      voteupCount: 12,
      createdAt: Date.parse('2023-11-14T22:13:20.000Z'),
    })

    // 后续加载的回答在接口层过滤
    const out = s.respond(
      'https://www.zhihu.com/api/v4/questions/2301/feeds?cursor=x',
      questionFeeds([apiAnswer('1', { author: { id: 'x', name: '用户3' } }), apiAnswer('2')]),
    ) as { data: { target: { id: string } }[] }
    expect(out.data.map(d => d.target.id)).toEqual(['2'])
  })

  test('回答页：用户打开的那个回答不过滤，其他回答照常', async () => {
    history.replaceState(null, '', '/question/9/answer/1')
    s = await setup({ plugins: [plugin(meta, z => z.filter('answers', () => false))] })
    s.root.append(
      html(`<div class="Card AnswerCard">${contentItem('answer', '1')}</div>`),
      html(listItem('answer', '2')),
    )
    await flush()
    expect(hidden($('[data-zb-id="answer:1"]'))).toBe(false)
    expect(hidden($('[data-zb-id="answer:2"]'))).toBe(true)
  })

  test('热榜：用链接识别问题', async () => {
    history.replaceState(null, '', '/hot')
    const seen: string[] = []
    s = await setup({
      plugins: [
        plugin(meta, z => {
          z.filter('feed', item => !item.content?.title.includes('屏蔽'))
          z.on('content', c => seen.push(`${c.type}:${c.id}:${c.title}`))
        }),
      ],
    })
    s.root.append(html(hotItem('3001', '热点问题')), html(hotItem('3002', '要屏蔽的问题')))
    await flush()
    expect(seen).toEqual(['question:3001:热点问题'])
    expect($('[data-zb-id="question:3002"]')?.hasAttribute('data-zb-hidden')).toBe(true)
  })

  test('带 data-zop 的独立元素（专栏文章）也识别；嵌套在内容元素里的不重复识别', async () => {
    const seen: string[] = []
    s = await setup({ plugins: [plugin(meta, z => z.on('content', c => seen.push(`${c.type}:${c.id}`)))] })
    const zop = (type: string, id: number) => `data-zop='${JSON.stringify({ itemId: id, type, title: 't' })}'`
    s.root.append(
      html(
        `<div class="TopstoryItem"><div class="ContentItem" ${zop('answer', 1)}><div class="ContentItem" ${zop('answer', 2)}>引用</div></div></div>`,
      ),
      html(`<article class="Post-Main" ${zop('article', 3)}><h1 class="Post-Title">文章</h1></article>`),
    )
    await flush()
    expect(seen).toEqual(['answer:1', 'article:3'])
    // 嵌套的元素也要标记为已处理，否则预隐藏会一直藏着它
    expect([...document.querySelectorAll('.ContentItem')].map(el => el.hasAttribute('data-zb-done'))).toEqual([
      true,
      true,
    ])
  })

  test('没有 data-zop 和 microdata 时，请页面主环境读 React 属性（只认仓库里有的）', async () => {
    s = await setup({ plugins: [plugin(meta, z => z.on('content', () => {}))] })
    s.respond(RECOMMEND, recommend([apiAnswer('77')]))
    const onAsk = () =>
      s?.send({
        type: 'react',
        refs: [
          { type: 'answer', id: '404' },
          { type: 'answer', id: '77' },
        ],
      })
    document.addEventListener(ASK_REACT, onAsk)
    s.root.append(
      html('<div class="TopstoryItem"><div class="ContentItem"><h2 class="ContentItem-title">无标记</h2></div></div>'),
    )
    await flush()
    document.removeEventListener(ASK_REACT, onAsk)
    expect($('.ContentItem')?.getAttribute('data-zb-id')).toBe('answer:77')
  })

  test('换页面：通知插件，按新页面重新过滤', async () => {
    const pages: PageInfo[] = []
    s = await setup({
      plugins: [
        plugin(meta, z => {
          z.filter('feed', () => false)
          z.on('page', p => pages.push(p))
        }),
      ],
    })
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    expect(hidden($('.ContentItem'))).toBe(true)
    history.pushState(null, '', '/people/someone')
    s.send({ type: 'route', url: location.href })
    await flush()
    expect(pages.map(p => p.type)).toEqual(['home', 'people'])
    // 用户主页不是信息流，不按信息流过滤
    expect(hidden($('.ContentItem'))).toBe(false)
  })
})

describe('评论', () => {
  test('评论接口在渲染前过滤；页面上带 data-id 的评论交给评论钩子', async () => {
    const seen: [string, ItemContext][] = []
    const withSetting = { ...meta, settings: { word: { type: 'string', label: '词', default: '广告' } } } as const
    s = await setup({
      plugins: [
        plugin(withSetting, z => {
          z.filter('comments', c => !c.text.includes(z.settings.get('word')))
          z.on('comment', (c, ctx) => {
            seen.push([c.id, ctx])
            ctx.ui.badge('楼主')
          })
        }),
      ],
    })
    const out = s.respond(
      'https://www.zhihu.com/api/v4/comment_v5/articles/9/root_comment?limit=10',
      rootComments([apiComment('c1'), apiComment('c2', { content: '<p>广告</p>' })]),
    ) as { data: { id: string }[] }
    expect(out.data.map(c => c.id)).toEqual(['c1'])
    s.root.append(
      html('<div data-id="c1"><a href="https://www.zhihu.com/people/user-6">用户6</a><div>一条评论</div></div>'),
    )
    await flush()
    expect(seen.map(([id]) => id)).toEqual(['c1'])
    const link = $('[data-id="c1"] a')
    expect(link?.nextElementSibling?.querySelector('.zb-badge')?.textContent).toBe('楼主')

    s.settings.update('p', { word: '评论' })
    await flush()
    expect($('[data-id="c1"]')?.hasAttribute('data-zb-hidden')).toBe(true)
    expect(seen[0]?.[1].signal.aborted).toBe(true)
  })

  test('仓库里没有的 data-id 元素不当作评论', async () => {
    s = await setup({ plugins: [plugin(meta, z => z.on('comment', () => {}))] })
    s.respond('https://www.zhihu.com/api/v4/comment_v5/articles/9/root_comment', rootComments([apiComment('c1')]))
    s.root.append(html('<div data-id="other">别的</div>'))
    await flush()
    expect($('[data-id="other"]')?.hasAttribute('data-zb-id')).toBe(false)
  })
})

describe('两栏布局', () => {
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  /** happy-dom 不排版：手动给元素指定位置 */
  function place(el: Element, x: number, width: number, height: number): void {
    el.getBoundingClientRect = () =>
      ({ x, y: 0, left: x, top: 0, width, height, right: x + width, bottom: height }) as DOMRect
  }

  test('主题要隐藏右侧栏时，按位置找到右侧栏并做标记；销毁后去掉', async () => {
    s = await setup()
    const page = html(
      `<div class="Topstory-container"><div class="wrap">${feedCard('answer', '1')}</div><div class="css-1qyytj7">右侧栏</div></div>`,
    )
    s.root.append(page)
    const side = page.lastElementChild as HTMLElement
    place(page, 0, 1000, 2000)
    for (const el of page.querySelectorAll('.wrap, .wrap *')) place(el, 0, 694, 1200)
    place(side, 704, 296, 900)
    await wait(150)
    // 没有要求隐藏右侧栏：不找
    expect(side.hasAttribute('data-zb-side')).toBe(false)

    const style = html('<style>:root { --zb-sidebar: none }</style>')
    document.head.append(style)
    s.adapter.theme.sync()
    await wait(150)
    expect(side.hasAttribute('data-zb-side')).toBe(true)
    expect(page.hasAttribute('data-zb-columns')).toBe(true)
    s.adapter.dispose()
    expect(side.hasAttribute('data-zb-side')).toBe(false)
    expect(page.hasAttribute('data-zb-columns')).toBe(false)
    style.remove()
  })

  test('问题页：从回答开始找，不从横跨整个页面的问题开始', async () => {
    history.replaceState(null, '', '/question/9')
    const style = html('<style>:root { --zb-sidebar: none }</style>')
    document.head.append(style)
    s = await setup()
    s.adapter.theme.sync()
    const header = html('<div class="QuestionHeader"><h1 class="QuestionHeader-title">问题</h1></div>')
    const main = html(
      `<div class="Question-main"><div class="ListShortcut">${listItem('answer', '1')}</div><div class="side">右侧栏</div></div>`,
    )
    s.root.append(header, main)
    place(header, 0, 1000, 200)
    for (const el of main.querySelectorAll('.ListShortcut, .ListShortcut *')) place(el, 0, 694, 1200)
    place(main.lastElementChild as Element, 704, 296, 900)
    await wait(150)
    expect(main.lastElementChild?.hasAttribute('data-zb-side')).toBe(true)
    style.remove()
  })

  test('换了一页（内容不在原来的布局里）时重新找', async () => {
    const style = html('<style>:root { --zb-sidebar: none }</style>')
    document.head.append(style)
    s = await setup()
    s.adapter.theme.sync()
    const first = html(
      `<div class="a"><div class="wrap">${feedCard('answer', '1')}</div><div class="side">一</div></div>`,
    )
    s.root.append(first)
    for (const el of first.querySelectorAll('.wrap, .wrap *')) place(el, 0, 694, 1200)
    place(first.lastElementChild as Element, 704, 296, 900)
    await wait(150)
    expect(first.lastElementChild?.hasAttribute('data-zb-side')).toBe(true)

    // 知乎把原来那一页留在页面上（不再有内容），内容出现在新的布局里
    first.querySelector('.Card')?.remove()
    const second = html(
      `<div class="b"><div class="wrap">${listItem('answer', '2')}</div><div class="side">二</div></div>`,
    )
    s.root.append(second)
    for (const el of second.querySelectorAll('.wrap, .wrap *')) place(el, 0, 694, 1200)
    place(second.lastElementChild as Element, 704, 296, 900)
    await wait(150)
    expect(second.lastElementChild?.hasAttribute('data-zb-side')).toBe(true)
    expect(second.hasAttribute('data-zb-columns')).toBe(true)
    // 原来的标记去掉
    expect(first.lastElementChild?.hasAttribute('data-zb-side')).toBe(false)
    expect(first.hasAttribute('data-zb-columns')).toBe(false)
    style.remove()
  })
})

describe('预隐藏与生命周期', () => {
  test('创建时打开预隐藏；插件迟迟没有加载完时超时放行', async () => {
    vi.useFakeTimers()
    try {
      const adapter = createAdapter({ prehideTimeout: 100 })
      expect(document.documentElement.hasAttribute('data-zb-prehide')).toBe(true)
      vi.advanceTimersByTime(150)
      expect(document.documentElement.hasAttribute('data-zb-prehide')).toBe(false)
      adapter.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('启动前出现的元素先排队（保持隐藏），启动后处理', async () => {
    s = await setup({ start: false, plugins: [plugin(meta, z => z.filter('feed', () => true))] })
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    expect($('.ContentItem')?.hasAttribute('data-zb-done')).toBe(false)
    s.adapter.start(s.host)
    expect($('.ContentItem')?.hasAttribute('data-zb-done')).toBe(true)
    expect(document.documentElement.hasAttribute('data-zb-prehide')).toBe(true)
    // 页面主环境晚到：打招呼时回复就绪
    const before = s.received.length
    s.send({ type: 'hello' })
    expect(s.received.slice(before).map(m => m.head.type)).toEqual(['ready'])
  })

  test('销毁后恢复页面', async () => {
    s = await setup({ plugins: [plugin(meta, z => z.filter('feed', () => false))] })
    s.root.append(html(feedCard('answer', '1')))
    await flush()
    expect(hidden($('.ContentItem'))).toBe(true)
    s.adapter.dispose()
    expect(hidden($('.ContentItem'))).toBe(false)
    expect(document.documentElement.hasAttribute('data-zb-prehide')).toBe(false)
  })
})
