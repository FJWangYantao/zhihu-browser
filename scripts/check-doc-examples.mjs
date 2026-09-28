// 对 docs/plugin-api.md 里的 TypeScript 示例做类型检查，保证文档和 packages/sdk 一致。
// 纯类型声明的代码块会跳过（以 SDK 源码为准）；代码片段会包进一个带 `z: PluginAPI` 参数的函数里再检查。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docPath = path.join(root, 'docs/plugin-api.md')
const outDir = path.join(root, 'packages/sdk/.doc-examples')

const md = fs.readFileSync(docPath, 'utf8')
const blocks = [...md.matchAll(/```ts\n([\s\S]*?)```/g)].map(m => ({
  code: m[1],
  line: md.slice(0, m.index).split('\n').length + 1,
}))

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const isDeclaration = code =>
  /^export (interface|type)\b/m.test(code) && !/export default function/.test(code) && !/export const meta/.test(code)

const files = []
for (const { code, line } of blocks) {
  if (isDeclaration(code)) continue
  let source
  if (/export default function/.test(code)) {
    source = code
  } else if (/export const meta/.test(code)) {
    // meta 加上"在入口函数里"的片段
    const [head, tail = ''] = code.split('// 在入口函数里：')
    source = `import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'\n${head}\nexport async function example(z: PluginAPI<typeof meta>, text: string) {\n${tail}\n}\n`
  } else {
    source = `import type { PluginAPI } from '@zhihu-browser/sdk'\nexport function example(z: PluginAPI) {\n${code}\n}\n`
  }
  const file = `line-${String(line).padStart(4, '0')}.ts`
  fs.writeFileSync(path.join(outDir, file), source)
  files.push(file)
}

fs.writeFileSync(
  path.join(outDir, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: '../../../tsconfig.base.json',
      compilerOptions: { paths: { '@zhihu-browser/sdk': ['../src/index.ts'] } },
      include: ['*.ts'],
    },
    null,
    2,
  ),
)

const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc')
const result = spawnSync(process.execPath, [tsc, '-p', path.join(outDir, 'tsconfig.json')], { encoding: 'utf8' })
if (result.status !== 0) {
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  console.error(`\ndocs/plugin-api.md 的示例没有通过类型检查（文件名里的数字是示例在文档中的行号）。`)
  process.exit(1)
}
console.log(`docs/plugin-api.md：${files.length} 个示例通过类型检查`)
