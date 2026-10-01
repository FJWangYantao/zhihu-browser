import { describe, expect, test } from 'vitest'
import { CompileError, compilePlugin } from '../src/index'

const catchError = (fn: () => unknown): CompileError => {
  try {
    fn()
  } catch (e) {
    return e as CompileError
  }
  throw new Error('应该抛出错误')
}

const GOOD = `
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'hide-videos',
  name: '隐藏视频',
  version: '1.0.0',
  api: 1,
  description: \`去掉视频\`,
  permissions: ['net:api.example.com'],
  settings: {
    min: { type: 'number', label: '最小', default: -1, min: -5 },
    words: { type: 'list', label: '词', default: [] },
    'quoted-key': { type: 'boolean', label: 'q', default: true },
  },
} satisfies PluginMeta

export default function (z: PluginAPI<typeof meta>) {
  z.filter('feed', item => item.content?.type !== 'video')
}
`

describe('compilePlugin', () => {
  test('转译 TS，静态解析出 meta', () => {
    const { meta, code } = compilePlugin(GOOD)
    expect(meta).toMatchObject({ id: 'hide-videos', name: '隐藏视频', api: 1, description: '去掉视频' })
    expect(meta.permissions).toEqual(['net:api.example.com'])
    expect(meta.settings?.min).toEqual({ type: 'number', label: '最小', default: -1, min: -5 })
    expect(meta.settings?.['quoted-key']).toMatchObject({ default: true })
    // 转成 CommonJS：导出落在 exports 上，类型都被去掉了
    expect(code).toMatch(/exports\.\s*default/)
    expect(code).toContain('exports.meta')
    expect(code).not.toContain('PluginAPI')
    expect(code).not.toContain('import ')
  })

  test('转译结果可以执行，并导出 meta 和默认函数', () => {
    const { code } = compilePlugin(GOOD)
    const exports: Record<string, unknown> = {}
    new Function('exports', code)(exports)
    expect((exports.meta as { id: string }).id).toBe('hide-videos')
    expect(typeof exports.default).toBe('function')
    const calls: string[] = []
    ;(exports.default as (z: unknown) => void)({ filter: (kind: string) => calls.push(kind) })
    expect(calls).toEqual(['feed'])
  })

  test('JS 文件同样可以', () => {
    const { meta } = compilePlugin(
      `export const meta = { id: 'js-plugin', name: 'JS', version: '0.1.0', api: 1 }
export default function (z) { z.log.info('hi') }`,
      'plugin.js',
    )
    expect(meta.id).toBe('js-plugin')
  })

  test('不执行插件的代码：meta 之外有副作用的代码不会运行', () => {
    // 如果被执行了，这里会抛错或改变全局状态
    ;(globalThis as { __ran?: boolean }).__ran = false
    compilePlugin(`
globalThis.__ran = true
export const meta = { id: 'x', name: 'x', version: '1.0.0', api: 1 }
export default function () {}
`)
    expect((globalThis as { __ran?: boolean }).__ran).toBe(false)
  })

  test.each([
    ['引用变量', `const id = 'a'\nexport const meta = { id, name: 'a', version: '1.0.0', api: 1 }`, '变量引用'],
    ['函数调用', `export const meta = { id: 'a', name: String('a'), version: '1.0.0', api: 1 }`, '函数调用'],
    ['模板插值', `const n = 1\nexport const meta = { id: 'a', name: \`a\${n}\`, version: '1.0.0', api: 1 }`, '插值'],
    ['展开', `const o = {}\nexport const meta = { ...o, id: 'a', name: 'a', version: '1.0.0', api: 1 }`, '展开'],
    ['计算属性', `export const meta = { ['id']: 'a', name: 'a', version: '1.0.0', api: 1 }`, '计算属性'],
    ['方法', `export const meta = { id: 'a', name() { return 'a' }, version: '1.0.0', api: 1 }`, '函数'],
    ['运算', `export const meta = { id: 'a', name: 'a' + 'b', version: '1.0.0', api: 1 }`, '运算'],
  ])('meta 里有%s时拒绝', (_name, source, fragment) => {
    const error = catchError(() => compilePlugin(`${source}\nexport default function () {}`))
    expect(error).toBeInstanceOf(CompileError)
    expect(error.message).toContain(fragment)
  })

  test('meta 不合法时列出问题', () => {
    const error = catchError(() =>
      compilePlugin(`export const meta = { id: 'Bad Id', version: '1', api: 2 }\nexport default function () {}`),
    )
    expect(error.problems.length).toBeGreaterThanOrEqual(3)
    expect(error.problems.every(p => p.startsWith('meta：'))).toBe(true)
  })

  test('缺少 meta 或默认导出', () => {
    expect(catchError(() => compilePlugin('export default function () {}')).message).toContain('缺少 export const meta')
    expect(
      catchError(() => compilePlugin(`export const meta = { id: 'a', name: 'a', version: '1.0.0', api: 1 }`)).message,
    ).toContain('缺少默认导出')
  })

  test('运行时 import 被拒绝，import type 可以', () => {
    const base = `export const meta = { id: 'a', name: 'a', version: '1.0.0', api: 1 }\nexport default function () {}`
    expect(catchError(() => compilePlugin(`import lodash from 'lodash'\nlodash.x()\n${base}`)).message).toContain(
      '不能 import 运行时依赖',
    )
    expect(() => compilePlugin(`import type { PluginAPI } from '@zhihu-browser/sdk'\n${base}`)).not.toThrow()
    // 只用作类型的普通 import 也会被去掉
    expect(() =>
      compilePlugin(
        `import { PluginAPI } from '@zhihu-browser/sdk'\nexport const meta = { id: 'a', name: 'a', version: '1.0.0', api: 1 }\nexport default function (z: PluginAPI) {}`,
      ),
    ).not.toThrow()
  })

  test('语法错误带位置', () => {
    const error = catchError(() => compilePlugin(`export const meta = {\nexport default function () {}`, 'a.js'))
    expect(error.message).toContain('语法错误')
  })

  test('源码太大时拒绝', () => {
    const error = catchError(() => compilePlugin(`// ${'x'.repeat(1024 * 1024)}`))
    expect(error.message).toContain('KB')
  })

  test('export { meta } 这种写法给出明确提示', () => {
    const error = catchError(() =>
      compilePlugin(
        `const meta = { id: 'a', name: 'a', version: '1.0.0', api: 1 }\nexport { meta }\nexport default function () {}`,
      ),
    )
    expect(error.message).toContain('export const meta')
  })
})
