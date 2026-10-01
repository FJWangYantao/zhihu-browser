import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'plugin-declutter',
    environment: 'happy-dom',
  },
})
