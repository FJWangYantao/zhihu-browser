import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'remote',
    environment: 'happy-dom',
  },
})
