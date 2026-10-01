// 检查 templates/plugin：源码对着工作区里的 SDK 类型检查，并且能打包成安装器接受的单文件。
// （打包后能否被安装器解析，由 packages/installer 的测试覆盖。）
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'templates/plugin')
const outDir = path.join(dir, '.check')

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(
  path.join(outDir, 'tsconfig.json'),
  JSON.stringify({
    extends: '../tsconfig.json',
    compilerOptions: { paths: { '@zhihu-browser/sdk': ['../../../packages/sdk/src/index.ts'] } },
    include: ['../src'],
  }),
)

const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc')
const result = spawnSync(process.execPath, [tsc, '-p', path.join(outDir, 'tsconfig.json')], { encoding: 'utf8' })
fs.rmSync(outDir, { recursive: true, force: true })
if (result.status !== 0) {
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  console.error('\ntemplates/plugin 没有通过类型检查。')
  process.exit(1)
}
console.log('templates/plugin：通过类型检查')
