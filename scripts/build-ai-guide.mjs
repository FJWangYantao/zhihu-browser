// 生成 docs/ai-guide.md：给 AI 阅读的插件编写指南。
//   docs/ai-guide.src.md   手写的说明，带两个占位符
//   packages/sdk/src/index.ts   完整的类型定义，原样嵌入
//   docs/examples/*.ts   示例插件，原样嵌入
// 用法：node scripts/build-ai-guide.mjs          生成
//       node scripts/build-ai-guide.mjs --check  检查 docs/ai-guide.md 是不是最新的（CI 用）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const types = read('packages/sdk/src/index.ts').trimEnd()
const examples = fs
  .readdirSync(path.join(root, 'docs/examples'))
  .filter(f => f.endsWith('.ts'))
  .sort()
  .map(file => {
    const source = read(`docs/examples/${file}`).trimEnd()
    return `### ${file}\n\n\`\`\`ts\n${source}\n\`\`\`\n`
  })
  .join('\n')

const output = read('docs/ai-guide.src.md')
  .replace('<!-- sdk-types -->', () => types)
  .replace('<!-- examples -->', () => examples)
  .replace(/\n{3,}/g, '\n\n')
  .trimEnd()
  .concat('\n')

const target = path.join(root, 'docs/ai-guide.md')
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) {
    console.error('docs/ai-guide.md 不是最新的，请运行 node scripts/build-ai-guide.mjs 重新生成')
    process.exit(1)
  }
  console.log('docs/ai-guide.md：是最新的')
} else {
  fs.writeFileSync(target, output)
  console.log(`已生成 docs/ai-guide.md（${output.length} 个字符，${examples.split('### ').length - 1} 个示例）`)
}
