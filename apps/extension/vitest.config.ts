import { defineProject } from 'vitest/config'

export default defineProject({
  // 设置页用 Preact 的 JSX（和 wxt.config.ts 一致）
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    name: 'extension',
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
