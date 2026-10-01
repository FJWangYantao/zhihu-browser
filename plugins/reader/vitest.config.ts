import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'plugin-reader',
    environment: 'happy-dom',
  },
})
