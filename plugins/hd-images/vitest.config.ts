import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'plugin-hd-images',
    environment: 'happy-dom',
  },
})
