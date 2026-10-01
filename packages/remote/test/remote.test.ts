import type { ContentContext, PluginAPI, SettingSpec } from '@zhihu-browser/sdk'
import { describe, expect, test, vi } from 'vitest'
import { NO_RUNTIME_MESSAGE } from '../src/index'
import { answer, comment, feedItem, flush, page, setupRemote, target } from './helpers'

describe('加载与停止', () => {
  test('用户插件通过代理加载，默认函数在运行时一侧执行', async () => {
    const entry = vi.fn()
    const { info } = await setupRemote({ entry })
    expect(info.state).toBe('active')
    expect(entry).toHaveBeenCalledTimes(1)
    expect(entry.mock.calls[0]?.[0].meta.id).toBe('user-plugin')
  })

  test('运行时不在线时，启动失败并给出提示', async () => {
    const { info, host } = await setupRemote({ entry: () => {}, noRuntime: true })
    expect(info.state).toBe('failed')
    expect(info.reason).toContain(NO_RUNTIME_MESSAGE)
    expect(host.plugin('user-plugin')?.state).toBe('failed')
  })

  test('插件的默认函数抛出错误时，启动失败并带上原因', async () => {
    const { info } = await setupRemote({
      entry: () => {
        throw new Error('写错了')
      },
    })
    expect(info.state).toBe('failed')
    expect(info.reason).toContain('写错了')
  })

  test('默认函数可以是 async 函数，返回的清理函数在停用时执行', async () => {
    const cleanup = vi.fn()
    const { host } = await setupRemote({
      entry: async () => {
        await flush()
        return cleanup
      },
    })
    expect(host.plugin('user-plugin')?.state).toBe('active')
    host.disable('user-plugin')
    await flush()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  test('停用后撤销全部登记，重新启用后再来一遍', async () => {
    const entry = vi.fn((z: PluginAPI) => {
      z.filter('feed', () => false)
      z.registerCommand('hi', { title: '你好', run: () => {} })
      z.addStyle('body{}')
    })
    const { host, styles } = await setupRemote({ entry })
    expect(host.shouldKeep('feed', feedItem())).toBe(false)
    expect(host.commands().map(c => c.id)).toEqual(['user-plugin.hi'])
    expect(styles.size).toBe(1)

    host.disable('user-plugin')
    expect(host.shouldKeep('feed', feedItem())).toBe(true)
    expect(host.commands()).toEqual([])
    expect(styles.size).toBe(0)

    await host.enable('user-plugin')
    expect(entry).toHaveBeenCalledTimes(2)
    expect(host.shouldKeep('feed', feedItem())).toBe(false)
    expect(host.commands()).toHaveLength(1)
    expect(styles.size).toBe(1)
  })
})

describe('过滤', () => {
  test('用户插件的过滤函数在宿主里同步生效', async () => {
    const { host } = await setupRemote({
      entry: z => {
        z.filter('feed', item => item.content?.type !== 'video')
        z.filter('answers', a => (a.voteupCount ?? 0) >= 10)
        z.filter('comments', c => !c.text.includes('广告'))
        z.filter('search', r => r.kind !== 'ad')
      },
    })
    expect(host.shouldKeep('feed', feedItem())).toBe(true)
    expect(host.shouldKeep('feed', feedItem({ content: { ...answer(), type: 'video' } as never }))).toBe(false)
    expect(host.shouldKeep('answers', answer({ voteupCount: 3 }))).toBe(false)
    expect(host.shouldKeep('answers', answer({ voteupCount: 30 }))).toBe(true)
    expect(host.shouldKeep('comments', comment({ text: '这是广告' }))).toBe(false)
    expect(host.shouldKeep('search', { id: 's', kind: 'ad' })).toBe(false)
    expect(host.hasFilters('feed')).toBe(true)
  })

  test('过滤函数出错时保留条目，并计入宿主的熔断', async () => {
    const { host, logs } = await setupRemote({
      entry: z =>
        z.filter('feed', () => {
          throw new Error('过滤坏了')
        }),
      hostOptions: { maxErrors: 3 },
    })
    for (let i = 0; i < 4; i++) expect(host.shouldKeep('feed', feedItem())).toBe(true)
    expect(logs.some(l => l.message.includes('过滤坏了'))).toBe(true)
    expect(host.plugin('user-plugin')?.state).toBe('failed')
  })

  test('撤销过滤函数后不再生效', async () => {
    let off = () => {}
    const { host } = await setupRemote({
      entry: z => {
        off = z.filter('feed', () => false)
      },
    })
    expect(host.shouldKeep('feed', feedItem())).toBe(false)
    off()
    expect(host.shouldKeep('feed', feedItem())).toBe(true)
  })

  test('过滤函数里读到的设置是最新的', async () => {
    const { host, settings } = await setupRemote({
      meta: { settings: { minVotes: { type: 'number', label: '最少赞数', default: 5 } } },
      entry: z => z.filter('answers', a => (a.voteupCount ?? 0) >= (z.settings.get('minVotes') as number)),
    })
    expect(host.shouldKeep('answers', answer({ voteupCount: 6 }))).toBe(true)
    settings.update('user-plugin', { minVotes: 10 })
    await flush()
    expect(host.shouldKeep('answers', answer({ voteupCount: 6 }))).toBe(false)
  })
})

describe('渲染钩子', () => {
  test('内容钩子拿到数据、页面元素，界面工具作用在正确的元素上', async () => {
    let seen: ContentContext | undefined
    const { host } = await setupRemote({
      entry: z => {
        z.on('content', (content, ctx) => {
          seen = ctx
          ctx.ui.badge(`${content.id} 号`, { tone: 'info' })
          ctx.ui.fold('不想看')
          ctx.ui.addAction({ label: '屏蔽', onClick: () => z.log.info('点击了') })
        })
      },
    })
    const t = target(answer({ id: '42' }))
    host.addContent(t.target.handle.data, t.target)
    await flush()
    expect([...t.decorations]).toEqual(['badge:42 号:info', 'fold:不想看', 'action:屏蔽'])
    expect(seen?.el).toBe(t.el)
    expect(seen?.page.type).toBe('other')
  })

  test('按钮被点击时回到用户插件的函数', async () => {
    const clicked = vi.fn()
    const { host } = await setupRemote({
      entry: z => z.on('content', (_c, ctx) => ctx.ui.addAction({ label: '点我', onClick: clicked })),
    })
    const t = target()
    host.addContent(t.target.handle.data, t.target)
    await flush()
    t.actions[0]?.onClick()
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  test('元素被移除时，上下文的 signal 中止，界面工具被清理', async () => {
    let signal: AbortSignal | undefined
    const { host } = await setupRemote({
      entry: z =>
        z.on('content', (_c, ctx) => {
          signal = ctx.signal
          ctx.ui.badge('标签')
        }),
    })
    const t = target()
    host.addContent(t.target.handle.data, t.target)
    await flush()
    expect(signal?.aborted).toBe(false)
    t.remove()
    expect(signal?.aborted).toBe(true)
  })

  test('撤销界面工具', async () => {
    const { host } = await setupRemote({
      entry: z =>
        z.on('content', (_c, ctx) => {
          const off = ctx.ui.badge('临时')
          ctx.ui.badge('常驻')
          off()
        }),
    })
    const t = target()
    host.addContent(t.target.handle.data, t.target)
    await flush()
    expect([...t.decorations]).toEqual(['badge:常驻'])
  })

  test('ctx.handle 的操作转给适配层', async () => {
    const { host } = await setupRemote({
      entry: z =>
        z.on('content', (_c, ctx) => {
          ctx.handle.expand()
          ctx.handle.scrollIntoView()
          z.storage.set('visible', ctx.handle.isVisible())
        }),
    })
    const t = target()
    host.addContent(t.target.handle.data, t.target)
    await flush()
    expect(t.calls).toEqual(['expand', 'scrollIntoView'])
  })

  test('在内容上挂载自定义界面，容器就是适配层给的那个', async () => {
    const { host } = await setupRemote({
      entry: z =>
        z.on('content', (_c, ctx) => {
          ctx.ui.mount('after', container => {
            container.textContent = '来自用户插件'
            return () => z.log.info('卸载')
          })
        }),
    })
    const t = target()
    host.addContent(t.target.handle.data, t.target)
    await flush()
    expect([...t.decorations]).toEqual(['mount:after'])
  })

  test('评论钩子', async () => {
    const { host } = await setupRemote({
      entry: z => z.on('comment', (c, ctx) => ctx.ui.badge(`评论 ${c.id}`)),
    })
    const t = target()
    host.addComment(comment({ id: 'c9' }), t.target)
    await flush()
    expect([...t.decorations]).toEqual(['badge:评论 c9'])
  })

  test('页面钩子：激活时触发一次，切换页面再触发', async () => {
    const pages: string[] = []
    const aborted: boolean[] = []
    const { host } = await setupRemote({
      entry: z =>
        z.on('page', (p, ctx) => {
          pages.push(p.type)
          ctx.signal.addEventListener('abort', () => aborted.push(true))
        }),
    })
    host.setPage(page('home'))
    await flush()
    host.setPage(page('question'))
    await flush()
    expect(pages).toEqual(['home', 'question'])
    expect(aborted).toEqual([true])
  })

  test('z.page() 跟随页面', async () => {
    let read: () => string = () => ''
    const { host } = await setupRemote({
      entry: z => {
        read = () => z.page().type
      },
    })
    host.setPage(page('article'))
    await flush()
    expect(read()).toBe('article')
  })

  test('已经在页面上的内容，在钩子登记之后补发', async () => {
    const seen: string[] = []
    const { host } = await setupRemote({
      entry: z =>
        z.registerCommand('watch', {
          title: '开始关注',
          run: () => void z.on('content', c => void seen.push(c.id)),
        }),
    })
    const t = target(answer({ id: '7' }))
    host.addContent(t.target.handle.data, t.target)
    await host.runCommand('user-plugin.watch')
    await flush()
    expect(seen).toEqual(['7'])
  })
})

describe('命令、快捷键和界面', () => {
  test('命令和快捷键', async () => {
    const run = vi.fn()
    const key = vi.fn()
    const { host } = await setupRemote({
      entry: z => {
        z.registerCommand('toggle', { title: '切换', keywords: ['开关'], when: ['home'], run })
        z.registerShortcut('x', key, { description: '做点事', when: ['home'] })
      },
    })
    expect(host.commands(page('home'))[0]).toMatchObject({
      id: 'user-plugin.toggle',
      title: '切换',
      keywords: ['开关'],
    })
    expect(host.commands(page('article'))).toEqual([])
    await host.runCommand('user-plugin.toggle')
    expect(run).toHaveBeenCalledTimes(1)
    expect(host.runShortcut('x', page('home'))).toBe(true)
    expect(key).toHaveBeenCalledTimes(1)
    expect(host.shortcuts()[0]?.description).toBe('做点事')
  })

  test('宿主拒绝非法登记时，错误回到插件代码里', async () => {
    let error: unknown
    await setupRemote({
      entry: z => {
        try {
          z.registerCommand('坏 id', { title: 't', run: () => {} })
        } catch (e) {
          error = e
        }
      },
    })
    expect(String(error)).toContain('命令 id')
  })

  test('toast、confirm 和全局挂载点', async () => {
    let confirmed: boolean | undefined
    const { toasts, globalMounts, host } = await setupRemote({
      entry: async z => {
        z.ui.toast('你好')
        confirmed = await z.ui.confirm('确定吗？')
        z.ui.mount('toolbar', container => {
          container.textContent = '工具栏'
          return () => z.log.info('卸载')
        })
      },
    })
    expect(toasts).toEqual(['你好'])
    expect(confirmed).toBe(true)
    expect(globalMounts[0]?.slot).toBe('toolbar')
    expect(globalMounts[0]?.container.textContent).toBe('工具栏')
    host.disable('user-plugin')
    expect(globalMounts[0]?.disposed).toBe(true)
  })

  test('addStyle', async () => {
    const { styles } = await setupRemote({ entry: z => void z.addStyle('.a{color:red}') })
    expect([...styles]).toEqual(['.a{color:red}'])
  })

  test('contents 里的内容可以操作', async () => {
    const t = target(answer({ id: '5' }))
    let ids: string[] = []
    let current: string | undefined
    const { host, contents } = await setupRemote({
      entry: z =>
        z.registerCommand('scan', {
          title: '扫描',
          run: () => {
            ids = z.contents.all().map(h => h.data.id)
            current = z.contents.current()?.data.id
            z.contents.current()?.collapse()
          },
        }),
    })
    contents.push(t.handle)
    await host.runCommand('user-plugin.scan')
    expect(ids).toEqual(['5'])
    expect(current).toBe('5')
    expect(t.calls).toEqual(['collapse'])
  })
})

describe('设置、存储、网络和日志', () => {
  const settingsMeta = {
    settings: {
      words: { type: 'list', label: '关键词', default: ['a'] },
      on: { type: 'boolean', label: '开', default: true },
    },
  } as unknown as { settings: Record<string, SettingSpec> }

  test('读取、修改设置，变化时通知', async () => {
    const changes: unknown[] = []
    let api!: PluginAPI
    const { settings } = await setupRemote({
      meta: settingsMeta,
      entry: z => {
        api = z
        z.settings.onChange(c => changes.push(c))
      },
    })
    expect(api.settings.get('on' as never)).toBe(true)
    await api.settings.set('words' as never, ['a', 'b'] as never)
    expect(settings.peek('user-plugin')).toMatchObject({ words: ['a', 'b'] })
    expect(api.settings.get('words' as never)).toEqual(['a', 'b'])
    expect(changes).toEqual([{ words: ['a', 'b'] }])
    settings.update('user-plugin', { words: ['a', 'b'], on: false })
    await flush()
    expect(api.settings.get('on' as never)).toBe(false)
    expect(changes).toHaveLength(2)
  })

  test('设置值不合法时被拒绝', async () => {
    let api!: PluginAPI
    await setupRemote({
      meta: settingsMeta,
      entry: z => {
        api = z
      },
    })
    await expect(api.settings.set('on' as never, 'x' as never)).rejects.toThrow('布尔值')
  })

  test('存储', async () => {
    let api!: PluginAPI
    const { storage } = await setupRemote({
      entry: z => {
        api = z
      },
    })
    await api.storage.set('k', { a: [1, 2] })
    expect(await api.storage.get('k')).toEqual({ a: [1, 2] })
    expect(await storage.get('user-plugin', 'k')).toEqual({ a: [1, 2] })
    expect(await api.storage.keys()).toEqual(['k'])
    await api.storage.delete('k')
    expect(await api.storage.get('k')).toBeUndefined()
  })

  test('fetch 受宿主的权限检查约束', async () => {
    let api!: PluginAPI
    const { fetches } = await setupRemote({
      meta: { permissions: ['net:api.example.com'] },
      entry: z => {
        api = z
      },
    })
    const response = await api.fetch('https://api.example.com/x')
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ hello: 'world' })
    expect(await response.text()).toBe('{"hello":"world"}')
    expect(fetches).toEqual([{ url: 'https://api.example.com/x' }])
    await expect(api.fetch('https://evil.example.org/')).rejects.toThrow('权限')
    await expect(api.fetch('https://www.zhihu.com/api')).rejects.toThrow('知乎')
  })

  test('日志带上插件前缀，进到宿主的日志里', async () => {
    const { logs } = await setupRemote({
      entry: z => {
        z.log.info('你好', { a: 1 }, new Error('x'))
        z.log.warn('小心')
      },
    })
    expect(logs.map(l => [l.level, l.message])).toEqual([
      ['info', '你好 {"a":1} Error: x'],
      ['warn', '小心'],
    ])
  })

  test('异步的钩子函数出错时记到日志里', async () => {
    const { host, logs } = await setupRemote({
      entry: z =>
        z.on('content', async () => {
          throw new Error('异步坏了')
        }),
    })
    const t = target()
    host.addContent(t.target.handle.data, t.target)
    await flush()
    expect(logs.some(l => l.level === 'error' && l.message.includes('异步坏了'))).toBe(true)
  })
})
