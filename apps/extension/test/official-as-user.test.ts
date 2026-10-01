import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compilePlugin } from '@zhihu-browser/installer'
import { describe, expect, test } from 'vitest'
import { officialPlugins } from '../src/plugins'

const pluginsDir = resolve(import.meta.dirname, '../../../plugins')

// M2 验收：任意一个官方插件以用户插件方式安装后，行为与内置时一致。
// 这里验证前提：官方插件的源码本身就是合法的单文件插件，安装器解析出的 meta 和内置的一模一样。
describe('官方插件作为用户插件', () => {
  test.each(officialPlugins.map(p => [p.meta.id, p.meta] as const))('%s 的源码可以直接安装', (id, meta) => {
    const dir = readdirSync(pluginsDir).find(name => name === id)
    expect(dir, `plugins/${id}`).toBeDefined()
    const source = readFileSync(resolve(pluginsDir, id, 'src/index.ts'), 'utf8')
    const compiled = compilePlugin(source, 'index.ts')
    expect(compiled.meta).toEqual(JSON.parse(JSON.stringify(meta)))

    // 转译出的脚本可以执行，导出默认函数
    const exports: Record<string, unknown> = {}
    new Function('exports', 'require', compiled.code)(exports, () => ({}))
    expect(typeof exports.default).toBe('function')
  })
})
