// 合成样本的生成：从合成的页面经过真正的采集工具（snapshotPage）生成 test/pages/synthetic-*.json。
// 平时检查已提交的文件和现在生成的一致（采集工具或合成页面变了但没更新样本时会失败）；
// UPDATE_FIXTURES=1 pnpm test 重新写入。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { pageInfo } from '../src/routes'
import { snapshotPage, stringifySnapshot } from '../src/snapshot'
import { mountSynthetic, SYNTHETIC_PAGES } from './synthetic'

const dir = join(import.meta.dirname, 'pages')

afterEach(() => {
  document.body.replaceChildren()
})

describe('合成的页面样本', () => {
  for (const spec of SYNTHETIC_PAGES) {
    test(`${spec.name}：已提交的样本和现在生成的一致`, () => {
      mountSynthetic(spec)
      const snapshot = snapshotPage(document, { page: pageInfo(spec.url), entities: spec.entities })
      snapshot.note =
        '合成样本：按 docs/spike-report.md 记录的知乎页面结构手工搭建，不是真实页面（见 test/synthetic.ts）'
      const text = `${stringifySnapshot(snapshot)}\n`
      const file = join(dir, `synthetic-${spec.name}.json`)
      if (process.env.UPDATE_FIXTURES) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(file, text)
      }
      // git 在 Windows 上检出时可能把换行转成 CRLF，比较时统一掉
      const read = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
      expect(read).toBe(text)
    })
  }
})
