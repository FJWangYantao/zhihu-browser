import { resolve } from 'node:path'
import { build } from 'esbuild'
import { describe, expect, test } from 'vitest'
import { compilePlugin } from '../src/index'

const plugins = resolve(import.meta.dirname, '../../../plugins')
const template = resolve(import.meta.dirname, '../../../templates/plugin/src/index.ts')

// 插件项目模板和需要依赖的插件都先用打包工具打成单文件再发布：打包后的文件也必须能被安装器解析
describe('打包工具生成的单文件插件', () => {
  test.each(['filter', 'theme', 'info', 'shortcuts', 'reader', 'hd-images', 'declutter'])(
    '%s 用 esbuild 打包后可以安装，meta 不变',
    async name => {
      const source = resolve(plugins, name, 'src/index.ts')
      const result = await build({
        entryPoints: [source],
        bundle: true,
        format: 'esm',
        target: 'es2022',
        write: false,
        legalComments: 'none',
      })
      const bundled = result.outputFiles[0]?.text ?? ''
      expect(bundled).toMatch(/export\s*\{/)
      const direct = compilePlugin(await (await import('node:fs/promises')).readFile(source, 'utf8'), 'index.ts')
      const compiled = compilePlugin(bundled, 'plugin.js')
      expect(compiled.meta).toEqual(direct.meta)
    },
  )

  test('插件项目模板用 esbuild 打包后可以安装', async () => {
    const result = await build({
      entryPoints: [template],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      write: false,
      legalComments: 'none',
    })
    const compiled = compilePlugin(result.outputFiles[0]?.text ?? '', 'plugin.js')
    expect(compiled.meta).toMatchObject({ id: 'long-answer-fold', api: 1 })
    expect(compiled.meta.settings).toHaveProperty('minWords')
  })
})
