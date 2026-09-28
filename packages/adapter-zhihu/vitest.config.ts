import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'adapter-zhihu',
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: { url: 'https://www.zhihu.com/' },
    },
  },
})
