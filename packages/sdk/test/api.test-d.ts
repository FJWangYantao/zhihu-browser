// 插件 API 的类型测试：该通过的要通过，该报错的要报错。
import { describe, expectTypeOf, test } from 'vitest'
import type {
  Answer,
  Content,
  ContentHandle,
  FeedItem,
  PluginAPI,
  PluginEntry,
  PluginMeta,
  PluginModule,
  SettingsOf,
} from '../src/index'

const meta = {
  id: 'example',
  name: '示例',
  version: '1.0.0',
  api: 1,
  settings: {
    minWords: { type: 'number', label: '字数', default: 3000 },
    authors: { type: 'list', label: '作者', default: [] },
    enabled: { type: 'boolean', label: '启用', default: true },
    mode: { type: 'select', label: '模式', default: 'fold', options: { fold: '折叠', remove: '去掉' } },
  },
} satisfies PluginMeta

declare const z: PluginAPI<typeof meta>

describe('设置', () => {
  test('按 meta.settings 推导值类型', () => {
    expectTypeOf(z.settings.get('minWords')).toEqualTypeOf<number>()
    expectTypeOf(z.settings.get('authors')).toEqualTypeOf<string[]>()
    expectTypeOf(z.settings.get('enabled')).toEqualTypeOf<boolean>()
    expectTypeOf(z.settings.get('mode')).toEqualTypeOf<string>()
  })

  test('拒绝未声明的键和错误的值类型', () => {
    // @ts-expect-error 未声明的设置项
    z.settings.get('nope')
    // @ts-expect-error list 设置的值必须是 string[]
    z.settings.set('authors', 'not-a-list')
  })

  test('没有声明设置项时，值可能是任意一种设置类型', () => {
    expectTypeOf<SettingsOf<{ id: 'x'; name: 'x'; version: '1'; api: 1 }>>().toEqualTypeOf<
      Record<string, boolean | number | string | string[]>
    >()
  })
})

describe('过滤与渲染钩子', () => {
  test('按 kind 推导参数类型', () => {
    z.filter('feed', item => {
      expectTypeOf(item).toEqualTypeOf<FeedItem>()
      return true
    })
    z.filter('answers', answer => {
      expectTypeOf(answer).toEqualTypeOf<Answer>()
      return true
    })
  })

  test('拒绝错误的用法', () => {
    // @ts-expect-error 过滤函数必须返回 boolean
    z.filter('answers', answer => answer.title)
    // @ts-expect-error 没有这种 kind
    z.filter('pins', () => true)
    // @ts-expect-error FeedItem 没有这个字段
    z.filter('feed', item => item.nope)
  })

  test('渲染钩子的上下文', () => {
    z.on('content', (content, ctx) => {
      expectTypeOf(content).toEqualTypeOf<Content>()
      expectTypeOf(ctx.handle).toEqualTypeOf<ContentHandle>()
    })
    z.on('comment', (_comment, ctx) => {
      // @ts-expect-error 评论没有内容操作
      ctx.handle.expand()
    })
  })
})

describe('meta', () => {
  test('拒绝不合法的 meta', () => {
    // @ts-expect-error api 只能是 1
    const badApi = { id: 'y', name: 'y', version: '1.0.0', api: 2 } satisfies PluginMeta
    const badPerm = {
      id: 'y',
      name: 'y',
      version: '1.0.0',
      api: 1,
      // @ts-expect-error 网络权限必须以 net: 开头
      permissions: ['api.example.com'],
    } satisfies PluginMeta
    void badApi
    void badPerm
  })

  test('插件模块的形状', () => {
    const entry: PluginEntry<typeof meta> = api => {
      api.log.info(api.meta.name)
      return () => {}
    }
    expectTypeOf<{ meta: typeof meta; default: typeof entry }>().toExtend<PluginModule<typeof meta>>()
  })
})
