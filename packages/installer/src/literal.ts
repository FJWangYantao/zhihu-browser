// 不执行代码，只把 AST 里的"纯字面量"取出来。
// 支持：对象、数组、字符串、数字、布尔值、null、没有插值的模板字符串、数字前的正负号。
// 其余（变量、函数调用、展开、计算属性、模板插值……）一律拒绝。

import type { Expression, Pattern, Property, SpreadElement } from 'acorn'

export class LiteralError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(message)
    this.name = 'LiteralError'
  }
}

type Node = Expression | SpreadElement | Pattern | null

export function evaluateLiteral(node: Node): unknown {
  if (!node) throw new LiteralError('不支持空位')
  switch (node.type) {
    case 'Literal':
      if ('regex' in node && node.regex) throw new LiteralError('不支持正则表达式', node.start)
      if ('bigint' in node && node.bigint) throw new LiteralError('不支持 BigInt', node.start)
      return node.value
    case 'TemplateLiteral':
      if (node.expressions.length > 0) throw new LiteralError('模板字符串里不能插值', node.start)
      return node.quasis.map(q => q.value.cooked ?? '').join('')
    case 'UnaryExpression': {
      if ((node.operator !== '-' && node.operator !== '+') || node.argument.type !== 'Literal') {
        throw new LiteralError(`不支持的表达式（${node.operator}）`, node.start)
      }
      const value = node.argument.value
      if (typeof value !== 'number') throw new LiteralError('正负号后面必须是数字', node.start)
      return node.operator === '-' ? -value : value
    }
    case 'ArrayExpression':
      return node.elements.map(e => {
        if (e?.type === 'SpreadElement') throw new LiteralError('不支持展开语法', e.start)
        return evaluateLiteral(e)
      })
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {}
      for (const p of node.properties) {
        if (p.type === 'SpreadElement') throw new LiteralError('不支持展开语法', p.start)
        out[propertyKey(p)] = evaluateLiteral(p.value as Expression)
        if (p.kind !== 'init' || p.method) throw new LiteralError('不支持方法和 getter / setter', p.start)
      }
      return out
    }
    default:
      throw new LiteralError(`meta 必须是纯字面量，不能包含 ${describe(node.type)}`, node.start)
  }
}

function propertyKey(p: Property): string {
  if (p.computed) throw new LiteralError('不支持计算属性名', p.start)
  if (p.key.type === 'Identifier') return p.key.name
  if (p.key.type === 'Literal' && (typeof p.key.value === 'string' || typeof p.key.value === 'number')) {
    return String(p.key.value)
  }
  throw new LiteralError('属性名必须是标识符或字符串', p.start)
}

const NAMES: Record<string, string> = {
  Identifier: '变量引用',
  CallExpression: '函数调用',
  NewExpression: 'new 表达式',
  MemberExpression: '属性访问',
  BinaryExpression: '运算',
  LogicalExpression: '逻辑运算',
  ConditionalExpression: '条件表达式',
  ArrowFunctionExpression: '函数',
  FunctionExpression: '函数',
  TemplateLiteral: '模板字符串',
  TaggedTemplateExpression: '模板标签',
  AwaitExpression: 'await',
  SequenceExpression: '逗号表达式',
  AssignmentExpression: '赋值',
}
const describe = (type: string) => NAMES[type] ?? type
