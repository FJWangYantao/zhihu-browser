import type { ContentContext, ItemContext, PageContext, PageInfo } from '@zhihu-browser/sdk'
import { describe, expect, test, vi } from 'vitest'
import { PluginLoadError } from '../src/index'
import { answer, comment, feedItem, flush, page, plugin, setup, target } from './helpers'

describe('加载与生命周期', () => {
  test('meta 不合法时抛出 PluginLoadError 并列出问题', async () => {
    const { host } = setup()
    const bad = { meta: { id: 'Bad Id', name: '', version: '1', api: 2 }, default: () => {} }
    const error = await host.load(bad as never).catch(e => e)
    expect(error).toBeInstanceOf(PluginLoadError)
    expect(error.problems.length).toBeGreaterThanOrEqual(4)
  })

  test('启用的插件立即运行，默认函数收到 z', async () => {
    const { host } = setup()
    const entry = vi.fn()
    const result = await host.load(plugin({ id: 'a' }, entry))
    expect(entry).toHaveBeenCalledTimes(1)
    expect(entry.mock.calls[0]?.[0].meta.id).toBe('a')
    expect(result.state).toBe('active')
  })

  test('同一个 id 不能加载两次', async () => {
    const { host } = setup()
    await host.load(plugin({ id: 'a' }, () => {}))
    await expect(host.load(plugin({ id: 'a' }, () => {}))).rejects.toBeInstanceOf(PluginLoadError)
  })

  test('未启用或处于安全模式时不运行', async () => {
    const entry = vi.fn()
    const { host } = setup()
    expect((await host.load(plugin({ id: 'a' }, entry), { enabled: false })).reason).toBe('未启用')

    const safe = setup({ safeMode: true }).host
    expect((await safe.load(plugin({ id: 'b' }, entry))).reason).toBe('安全模式')
    expect((await safe.enable('b')).state).toBe('inactive')
    expect(entry).not.toHaveBeenCalled()
  })

  test('停用时撤销插件注册的一切，并调用它返回的清理函数', async () => {
    const { host, styles, mounts } = setup()
    const cleanup = vi.fn()
    let z!: Parameters<Parameters<typeof plugin>[1]>[0]
    await host.load(
      plugin({ id: 'a' }, api => {
        z = api
        api.addStyle('.x{}')
        api.registerCommand('go', { title: '走', run() {} })
        api.registerShortcut('j', () => {}, { description: '下一条' })
        api.filter('feed', () => false)
        api.ui.mount('toolbar', () => {})
        return cleanup
      }),
    )
    expect(styles.size).toBe(1)
    expect(host.commands()).toHaveLength(1)
    expect(host.shortcuts()).toHaveLength(1)
    expect(host.hasFilters('feed')).toBe(true)

    const info = host.disable('a')
    expect(info).toMatchObject({ state: 'inactive', reason: '已停用', enabled: false })
    expect(styles.size).toBe(0)
    expect(host.commands()).toHaveLength(0)
    expect(host.shortcuts()).toHaveLength(0)
    expect(host.hasFilters('feed')).toBe(false)
    expect(mounts[0]?.disposed).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(1)

    // 停用后，残留的 z 引用不再生效
    z.addStyle('.y{}')
    z.registerCommand('late', { title: '晚了', run() {} })
    expect(styles.size).toBe(0)
    expect(host.commands()).toHaveLength(0)
    await expect(z.storage.get('k')).rejects.toThrow('已停用')
  })

  test('默认函数出错时状态为 failed', async () => {
    const { host } = setup()
    const info = await host.load(
      plugin({ id: 'a' }, () => {
        throw new Error('坏了')
      }),
    )
    expect(info.state).toBe('failed')
    expect(info.reason).toContain('坏了')
  })

  test('async 默认函数返回的清理函数也会被调用', async () => {
    const { host } = setup()
    const cleanup = vi.fn()
    await host.load(
      plugin({ id: 'a' }, async () => {
        await Promise.resolve()
        return cleanup
      }),
    )
    host.disable('a')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  test('reload 替换插件，并保持原来的启用状态', async () => {
    const { host } = setup()
    await host.load(plugin({ id: 'a' }, z => void z.registerCommand('old', { title: '旧', run() {} })))
    await host.reload(plugin({ id: 'a' }, z => void z.registerCommand('new', { title: '新', run() {} })))
    expect(host.commands().map(c => c.id)).toEqual(['a.new'])

    const entry = vi.fn()
    await host.load(
      plugin({ id: 'b' }, () => {}),
      { enabled: false },
    )
    expect((await host.reload(plugin({ id: 'b' }, entry))).state).toBe('inactive')
    expect(entry).not.toHaveBeenCalled()
  })

  test('状态变化会通知宿主的监听者', async () => {
    const { host } = setup()
    const states: string[] = []
    host.on('pluginState', info => states.push(`${info.id}:${info.state}`))
    await host.load(plugin({ id: 'a' }, () => {}))
    host.disable('a')
    await host.enable('a')
    host.unload('a')
    expect(states).toEqual(['a:active', 'a:inactive', 'a:active', 'a:inactive'])
    expect(host.plugin('a')).toBeUndefined()
  })
})

describe('页面', () => {
  test('激活后收到当前页面，之后每次切换页面再收到；离开页面时 signal 中止', async () => {
    const { host } = setup()
    host.setPage(page('home'))
    const seen: { page: PageInfo; ctx: PageContext }[] = []
    await host.load(plugin({ id: 'a' }, z => void z.on('page', (p, ctx) => seen.push({ page: p, ctx }))))
    await flush()
    expect(seen.map(s => s.page.type)).toEqual(['home'])

    host.setPage(page('question'))
    expect(seen.map(s => s.page.type)).toEqual(['home', 'question'])
    expect(seen[0]?.ctx.signal.aborted).toBe(true)
    expect(seen[1]?.ctx.signal.aborted).toBe(false)

    host.disable('a')
    expect(seen[1]?.ctx.signal.aborted).toBe(true)
  })

  test('晚注册的页面钩子也会收到当前页面，但不会重复', async () => {
    const { host } = setup()
    host.setPage(page('home'))
    const handler = vi.fn()
    await host.load(plugin({ id: 'a' }, z => void setTimeout(() => z.on('page', handler), 0)))
    await flush()
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    host.setPage(page('hot'))
    expect(handler).toHaveBeenCalledTimes(2)
  })

  test('注册页面钩子和补发之间切换了页面：每个页面只交付一次', async () => {
    const { host } = setup()
    host.setPage(page('home'))
    let z!: Parameters<Parameters<typeof plugin>[1]>[0]
    await host.load(
      plugin({ id: 'a' }, api => {
        z = api
      }),
    )
    const handler = vi.fn()
    z.on('page', handler)
    host.setPage(page('hot'))
    await flush()
    expect(handler.mock.calls.map(c => c[0].type)).toEqual(['hot'])
  })

  test('撤销页面钩子后，之前拿到的 signal 仍在离开页面时中止', async () => {
    const { host } = setup()
    host.setPage(page('home'))
    let signal: AbortSignal | undefined
    await host.load(
      plugin({ id: 'a' }, z => {
        const off = z.on('page', (_p, ctx) => {
          signal = ctx.signal
          off()
        })
      }),
    )
    await flush()
    host.setPage(page('hot'))
    expect(signal?.aborted).toBe(true)
  })
})

describe('过滤', () => {
  test('任何一个过滤函数返回 false，这条数据就去掉', async () => {
    const { host } = setup()
    await host.load(plugin({ id: 'no-ads' }, z => void z.filter('feed', item => item.kind !== 'ad')))
    await host.load(
      plugin({ id: 'no-words' }, z => void z.filter('feed', item => !item.content?.title.includes('营销'))),
    )
    expect(host.shouldKeep('feed', feedItem())).toBe(true)
    expect(host.shouldKeep('feed', feedItem({ kind: 'ad' }))).toBe(false)
    expect(host.shouldKeep('feed', feedItem({ content: answer({ title: '营销号' }) }))).toBe(false)
    expect(host.shouldKeep('answers', answer({ title: '营销号' }))).toBe(true)
  })

  test('过滤函数出错或返回 Promise 时按保留处理', async () => {
    const { host, logs } = setup()
    await host.load(
      plugin({ id: 'a' }, z => {
        z.filter('feed', () => {
          throw new Error('坏了')
        })
        z.filter('answers', (async () => false) as never)
      }),
    )
    expect(host.shouldKeep('feed', feedItem())).toBe(true)
    expect(host.shouldKeep('answers', answer())).toBe(true)
    expect(host.shouldKeep('answers', answer())).toBe(true)
    expect(host.plugin('a')?.stats.errors).toBe(1)
    expect(logs.filter(l => l.message.includes('必须是同步的'))).toHaveLength(1)
  })

  test('filtersChanged 在注册、撤销、设置变化时触发，同一轮只触发一次', async () => {
    const { host, settings } = setup()
    const changed = vi.fn()
    host.on('filtersChanged', changed)
    await host.load(
      plugin({ id: 'a', settings: { words: { type: 'list', label: '词', default: [] } } }, z => {
        z.filter('feed', () => true)
        z.filter('answers', () => true)
      }),
    )
    await flush()
    expect(changed).toHaveBeenCalledTimes(1)

    settings.update('a', { words: ['x'] })
    await flush()
    expect(changed).toHaveBeenCalledTimes(2)

    host.disable('a')
    await flush()
    expect(changed).toHaveBeenCalledTimes(3)
  })
})

describe('渲染钩子', () => {
  test('内容交给插件；插件添加的界面元素随插件停用而撤销', async () => {
    const { host } = setup()
    await host.load(
      plugin({ id: 'a' }, z => {
        z.on('content', (content, ctx) => {
          ctx.ui.badge(content.title)
          ctx.ui.mount('after', () => {})
        })
      }),
    )
    const t = target()
    host.addContent(answer(), t.target)
    expect([...t.decorations]).toEqual(['badge:一个问题', 'mount:after'])
    host.disable('a')
    expect(t.decorations.size).toBe(0)
  })

  test('已经在页面上的内容会补发给后注册的钩子，并且不会重复', async () => {
    const { host } = setup()
    host.addContent(answer({ id: '1' }), target().target)
    const handler = vi.fn()
    await host.load(plugin({ id: 'a' }, z => void z.on('content', handler)))
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    host.addContent(answer({ id: '2' }), target().target)
    await flush()
    expect(handler.mock.calls.map(c => c[0].id)).toEqual(['1', '2'])
  })

  test('注册钩子和补发之间出现的内容只交付一次', async () => {
    const { host } = setup()
    let z!: Parameters<Parameters<typeof plugin>[1]>[0]
    await host.load(
      plugin({ id: 'a' }, api => {
        z = api
      }),
    )
    const handler = vi.fn()
    z.on('content', handler) // 补发安排在微任务里
    host.addContent(answer({ id: '2' }), target().target) // 同步交付
    await flush() // 补发运行，不能再交付一次
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('元素被移除后不再补发，之前的 ctx.signal 中止', async () => {
    const { host } = setup()
    let ctx: ContentContext | undefined
    await host.load(
      plugin({ id: 'a' }, z => {
        z.on('content', (_c, c) => {
          ctx = c
        })
      }),
    )
    const t = target()
    host.addContent(answer(), t.target)
    t.remove()
    expect(ctx?.signal.aborted).toBe(true)

    const late = vi.fn()
    await host.load(plugin({ id: 'b' }, z => void z.on('content', late)))
    await flush()
    expect(late).not.toHaveBeenCalled()
  })

  test('评论钩子', async () => {
    const { host } = setup()
    let received: { text: string; ctx: ItemContext } | undefined
    await host.load(
      plugin({ id: 'a' }, z => {
        z.on('comment', (c, ctx) => {
          received = { text: c.text, ctx }
        })
      }),
    )
    host.addComment(comment(), target().target)
    expect(received?.text).toBe('一条评论')
    expect('handle' in (received?.ctx ?? {})).toBe(false)
  })

  test('按钮的点击回调出错不会影响宿主，并计入报错', async () => {
    const { host } = setup()
    await host.load(
      plugin({ id: 'a' }, z => {
        z.on('content', (_c, ctx) => {
          ctx.ui.addAction({
            label: '点我',
            onClick() {
              throw new Error('坏了')
            },
          })
        })
      }),
    )
    const t = target()
    host.addContent(answer(), t.target)
    expect(() => t.actions[0]?.onClick()).not.toThrow()
    expect(host.plugin('a')?.stats.errors).toBe(1)
  })
})

describe('熔断', () => {
  test('1 分钟内报错超过 10 次自动停用', async () => {
    const { host } = setup()
    const fn = vi.fn(() => {
      throw new Error('坏了')
    })
    await host.load(plugin({ id: 'a' }, z => void z.filter('feed', fn)))
    for (let i = 0; i < 12; i++) host.shouldKeep('feed', feedItem())
    const info = host.plugin('a')
    expect(info?.state).toBe('failed')
    expect(info?.reason).toContain('报错超过 10 次')
    expect(fn).toHaveBeenCalledTimes(11)
  })

  test('超出时间窗口的报错不累计', async () => {
    const { host, advance } = setup()
    await host.load(
      plugin({ id: 'a' }, z => {
        z.filter('feed', () => {
          throw new Error('坏了')
        })
      }),
    )
    for (let i = 0; i < 20; i++) {
      host.shouldKeep('feed', feedItem())
      advance(10_000)
    }
    expect(host.plugin('a')?.state).toBe('active')
  })

  test('持续超出耗时预算会被标记为 slow', async () => {
    const { host, advance } = setup()
    await host.load(
      plugin({ id: 'a' }, z => {
        z.filter('feed', () => {
          advance(2)
          return true
        })
      }),
    )
    for (let i = 0; i < 20; i++) host.shouldKeep('feed', feedItem())
    const stats = host.plugin('a')?.stats
    expect(stats?.slow).toEqual(['filter'])
    expect(stats?.hooks.filter).toMatchObject({ calls: 20, overBudget: 20, maxMs: 2 })
  })
})

describe('设置', () => {
  const meta = {
    id: 'a',
    settings: {
      minWords: { type: 'number' as const, label: '字数', default: 3000, min: 0 },
      words: { type: 'list' as const, label: '词', default: [] as string[] },
    },
  }

  test('保存的值覆盖默认值；不合法的值改用默认值并记日志', async () => {
    const { host, logs } = setup({ settings: { a: { minWords: 'abc', words: ['x'], unknown: 1 } } })
    let z!: Parameters<Parameters<typeof plugin>[1]>[0]
    await host.load(
      plugin(meta, api => {
        z = api
      }),
    )
    expect(z.settings.get('minWords')).toBe(3000)
    expect(z.settings.get('words')).toEqual(['x'])
    expect(logs.some(l => l.level === 'warn' && l.message.includes('minWords'))).toBe(true)
  })

  test('set 校验类型、保存并触发 onChange', async () => {
    const { host, settings } = setup()
    const onChange = vi.fn()
    let z!: Parameters<Parameters<typeof plugin>[1]>[0]
    await host.load(
      plugin(meta, api => {
        z = api
        api.settings.onChange(onChange)
      }),
    )
    await z.settings.set('minWords', 100)
    expect(settings.peek('a')).toEqual({ minWords: 100, words: [] })
    expect(onChange).toHaveBeenCalledWith({ minWords: 100 })
    await expect(z.settings.set('minWords', 'x' as never)).rejects.toThrow('必须是数字')
    await expect(z.settings.set('minWords', -1)).rejects.toThrow('不能小于 0')
    await expect(z.settings.set('nope', 1)).rejects.toThrow('没有声明设置项')
  })

  test('外部修改会通知 onChange，只包含变化的键', async () => {
    const { host, settings } = setup()
    const onChange = vi.fn()
    await host.load(plugin(meta, z => void z.settings.onChange(onChange)))
    settings.update('a', { minWords: 3000, words: ['a', 'b'] })
    expect(onChange).toHaveBeenCalledWith({ words: ['a', 'b'] })
    settings.update('a', { minWords: 3000, words: ['a', 'b'] })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  test('读到的设置值不能被直接修改', async () => {
    const { host } = setup({ settings: { a: { words: ['x'] } } })
    let z!: Parameters<Parameters<typeof plugin>[1]>[0]
    await host.load(
      plugin(meta, api => {
        z = api
      }),
    )
    expect(() => (z.settings.get('words') as string[]).push('y')).toThrow(TypeError)
  })
})

describe('命令与快捷键', () => {
  test('命令 id 带插件前缀；重复注册报错；按页面过滤', async () => {
    const { host } = setup()
    host.setPage(page('home'))
    await host.load(
      plugin({ id: 'reader' }, z => {
        z.registerCommand('toggle', { title: '阅读模式', when: ['answer'], run() {} })
        z.registerCommand('help', { title: '帮助', run() {} })
        expect(() => z.registerCommand('help', { title: '帮助', run() {} })).toThrow('已经注册过')
      }),
    )
    expect(host.commands().map(c => c.id)).toEqual(['reader.help'])
    expect(host.commands(page('answer')).map(c => c.id)).toEqual(['reader.toggle', 'reader.help'])
  })

  test('runCommand 执行命令；异步命令的错误被记录，不会抛出', async () => {
    const { host } = setup()
    const run = vi.fn()
    await host.load(
      plugin({ id: 'a' }, z => {
        z.registerCommand('ok', { title: '好', run })
        z.registerCommand('bad', {
          title: '坏',
          async run() {
            throw new Error('坏了')
          },
        })
      }),
    )
    await host.runCommand('a.ok')
    await expect(host.runCommand('a.bad')).resolves.toBeUndefined()
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    expect(host.plugin('a')?.stats.errors).toBe(1)
  })

  test('同一个快捷键：先注册的生效，撤销后轮到下一个', async () => {
    const { host } = setup()
    const first = vi.fn()
    const second = vi.fn()
    await host.load(plugin({ id: 'a' }, z => void z.registerShortcut('Shift+J', first, { description: '一' })))
    await host.load(plugin({ id: 'b' }, z => void z.registerShortcut('shift+j', second, { description: '二' })))
    expect(host.shortcuts()).toMatchObject([
      { keys: 'shift+j', pluginId: 'a' },
      { keys: 'shift+j', pluginId: 'b', conflictWith: 'a' },
    ])
    expect(host.runShortcut('J+shift' as string)).toBe(false)
    expect(host.runShortcut('shift+J')).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
    host.disable('a')
    host.runShortcut('shift+j')
    expect(second).toHaveBeenCalledTimes(1)
  })

  test('快捷键按页面类型生效，写法不对时注册报错', async () => {
    const { host } = setup()
    host.setPage(page('home'))
    const run = vi.fn()
    await host.load(
      plugin({ id: 'a' }, z => {
        z.registerShortcut('r', run, { description: '阅读', when: ['answer'] })
        expect(() => z.registerShortcut('hyper+x', () => {}, { description: '坏' })).toThrow('修饰键')
        expect(() => z.registerShortcut('j', () => {}, { description: '' })).toThrow('description')
      }),
    )
    expect(host.runShortcut('r')).toBe(false)
    expect(host.runShortcut('r', page('answer'))).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('存储与网络', () => {
  test('存储按插件隔离，值必须能被 JSON 序列化', async () => {
    const { host } = setup()
    const apis: Parameters<Parameters<typeof plugin>[1]>[0][] = []
    await host.load(plugin({ id: 'a' }, z => void apis.push(z)))
    await host.load(plugin({ id: 'b' }, z => void apis.push(z)))
    const [a, b] = apis
    await a?.storage.set('k', { n: 1 })
    expect(await a?.storage.get('k')).toEqual({ n: 1 })
    expect(await b?.storage.get('k')).toBeUndefined()
    expect(await a?.storage.keys()).toEqual(['k'])
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(a?.storage.set('c', circular)).rejects.toThrow('JSON')
    await expect(a?.storage.set('u', undefined)).rejects.toThrow('JSON')
    await expect(a?.storage.set('', 1)).rejects.toThrow('键')
  })

  test('fetch 只能访问声明过的域名，不能访问知乎', async () => {
    const { host, fetches } = setup()
    let z!: Parameters<Parameters<typeof plugin>[1]>[0]
    await host.load(
      plugin({ id: 'a', permissions: ['net:api.example.com', 'net:*.cdn.example.org'] }, api => {
        z = api
      }),
    )
    await z.fetch('https://api.example.com/v1')
    await z.fetch('https://img.cdn.example.org/x.png', { timeout: 999_999 })
    await expect(z.fetch('https://evil.example.net/')).rejects.toThrow('net:evil.example.net')
    await expect(z.fetch('https://www.zhihu.com/api/v4/me')).rejects.toThrow('知乎')
    await expect(z.fetch('/relative')).rejects.toThrow('完整的网址')
    expect(fetches).toEqual([
      { pluginId: 'a', url: 'https://api.example.com/v1', timeout: 30_000 },
      { pluginId: 'a', url: 'https://img.cdn.example.org/x.png', timeout: 120_000 },
    ])
  })
})

describe('日志', () => {
  test('z.log 带插件 id，最多保留 200 条', async () => {
    const { host } = setup()
    await host.load(
      plugin({ id: 'a' }, z => {
        for (let i = 0; i < 205; i++) z.log.info('第', i, '条', { ok: true })
      }),
    )
    const logs = host.logs('a')
    expect(logs).toHaveLength(200)
    expect(logs.at(-1)).toMatchObject({ pluginId: 'a', level: 'info', message: '第 204 条 {"ok":true}' })
  })
})
