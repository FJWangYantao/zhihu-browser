import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'adapter-zhihu',
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: { url: 'https://www.zhihu.com/' },
    },
    // 测试里用 ?raw 读取映射样式的原文（Vitest 默认把 CSS 当作空文件）
    css: { include: [/theme\.css/] },
  },
})
