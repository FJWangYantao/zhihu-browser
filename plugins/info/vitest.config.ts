import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'plugin-info',
    environment: 'node',
    // 时间按本地时区显示，测试固定用北京时间
    env: { TZ: 'Asia/Shanghai' },
  },
})
