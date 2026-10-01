// 把插件源码（TS 或 JS，ES module 写法）变成可以在用户脚本环境里执行的脚本，同时静态解析出 meta。
// 在用户确认之前，插件的任何代码都不会被执行。

import { validateMeta } from '@zhihu-browser/core'
import type { PluginMeta } from '@zhihu-browser/sdk'
import { type Node as AcornNode, parse } from 'acorn'
import { transform } from 'sucrase'
import { evaluateLiteral, LiteralError } from './literal'

/** 插件源码的大小上限 */
export const MAX_SOURCE_BYTES = 1024 * 1024

export class CompileError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('；'))
    this.name = 'CompileError'
  }
}

export interface CompiledPlugin {
  meta: PluginMeta
  /** 可执行的脚本：CommonJS 写法，导出落在 `exports` 上 */
  code: string
}

type Program = AcornNode & { body: (AcornNode & Record<string, unknown>)[] }

const isTypeScript = (filename: string) => !/\.(?:m?js|cjs)$/i.test(filename)

function parseProgram(code: string): Program {
  try {
    return parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as unknown as Program
  } catch (e) {
    const err = e as { message: string; loc?: { line: number; column: number } }
    const where = err.loc ? `（第 ${err.loc.line} 行第 ${err.loc.column + 1} 列）` : ''
    throw new CompileError([`语法错误${where}：${err.message.replace(/\s*\(\d+:\d+\)$/, '')}`])
  }
}

/** 找到 meta 的字面量（`export const meta = {…}`，或打包工具生成的 `export { meta }`），返回它的值 */
function extractMeta(program: Program, original: string): unknown {
  let hasDefault = false
  let found: unknown
  let foundMeta = false
  const problems: string[] = []
  /** 顶层 const / let / var 声明：变量名 → 初始值 */
  const initializers = new Map<string, unknown>()
  for (const node of program.body) {
    if (node.type !== 'VariableDeclaration') continue
    for (const d of node.declarations as { id: { type: string; name?: string }; init: unknown }[]) {
      if (d.id.type === 'Identifier' && d.id.name) initializers.set(d.id.name, d.init)
    }
  }

  const readMeta = (init: unknown) => {
    foundMeta = true
    try {
      found = evaluateLiteral(init as never)
    } catch (e) {
      if (!(e instanceof LiteralError)) throw e
      const line = e.position === undefined ? '' : `（第 ${lineOf(original, e.position)} 行附近）`
      problems.push(`meta：${e.message}${line}`)
    }
  }

  for (const node of program.body) {
    if (node.type === 'ImportDeclaration') {
      problems.push(
        `单文件插件不能 import 运行时依赖（${String((node.source as { value: unknown }).value)}）；需要依赖时请先打包成单文件`,
      )
    }
    if (node.type === 'ExportAllDeclaration') problems.push('不支持 export * from')
    if (node.type === 'ExportDefaultDeclaration') hasDefault = true
    if (node.type !== 'ExportNamedDeclaration') continue
    if (node.source) {
      problems.push('不支持 export … from')
      continue
    }
    const decl = node.declaration as (AcornNode & Record<string, unknown>) | null
    if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations as { id: { type: string; name?: string }; init: unknown }[]) {
        if (d.id.type === 'Identifier' && d.id.name === 'meta') readMeta(d.init)
      }
    } else if (!decl && Array.isArray(node.specifiers)) {
      // export { meta, handler as default }：打包工具常见的写法
      for (const spec of node.specifiers as { local: { name?: string }; exported: { name?: string } }[]) {
        if (spec.exported.name === 'default') hasDefault = true
        if (spec.exported.name !== 'meta') continue
        const local = spec.local.name
        if (local && initializers.has(local)) readMeta(initializers.get(local))
        else problems.push('meta 必须是 export const meta = { … }，或者对应一个顶层的对象字面量变量')
      }
    }
  }
  if (!foundMeta && problems.length === 0) problems.push('缺少 export const meta = { … }')
  if (!hasDefault) problems.push('缺少默认导出：export default function (z) { … }')
  if (problems.length) throw new CompileError(problems)
  return found
}

const lineOf = (source: string, position: number) => source.slice(0, position).split('\n').length

export function compilePlugin(source: string, filename = 'plugin.ts'): CompiledPlugin {
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) {
    throw new CompileError([`插件源码超过 ${MAX_SOURCE_BYTES / 1024} KB`])
  }
  const ts = isTypeScript(filename)
  let esm: string
  let cjs: string
  try {
    // 只去掉类型、保留 ES module 写法：用来静态分析
    esm = transform(source, { transforms: ts ? ['typescript'] : [], disableESTransforms: true }).code
    cjs = transform(source, {
      transforms: ts ? ['typescript', 'imports'] : ['imports'],
      disableESTransforms: true,
    }).code
  } catch (e) {
    throw new CompileError([`语法错误：${(e as Error).message}`])
  }
  const meta = extractMeta(parseProgram(esm), esm)
  const problems = validateMeta(meta)
  if (problems.length) throw new CompileError(problems.map(p => `meta：${p}`))
  return { meta: meta as PluginMeta, code: cjs }
}
