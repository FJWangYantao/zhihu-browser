import type { Platform } from '@zhihu-browser/core'

/** 当前系统：决定快捷键里的 mod 是 ⌘（macOS）还是 Ctrl */
export function detectPlatform(nav: Navigator = navigator): Platform {
  const data = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const name = data?.platform || nav.platform || nav.userAgent
  return /mac|iphone|ipad/i.test(name) ? 'mac' : 'other'
}
