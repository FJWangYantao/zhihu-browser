// 设置页与后台之间的消息（用户插件的安装、启用、卸载）。
// 后台只接受来自扩展自己页面的这类消息，内容脚本（在知乎页面里运行）发来的一律拒绝。

import type { InstallResult, PlanView } from './manager'

export const MANAGE_MESSAGE = 'user-plugins'

export type ManageRequest =
  | { op: 'plan'; source: string; fileName?: string }
  | { op: 'install'; source: string; fileName?: string }
  | { op: 'set-enabled'; id: string; enabled: boolean }
  | { op: 'uninstall'; id: string }
  | { op: 'status' }

export interface ManageReplies {
  plan: PlanView
  install: Omit<InstallResult, 'plan'> & { plan: PlanView }
  'set-enabled': null
  uninstall: null
  status: { available: boolean }
}

export type ManageReply<T> = { ok: true; value: T } | { ok: false; error: string; problems?: string[] }
