import type { HookKind, HookStats, PluginStats } from './types'

/** 每次调用的耗时预算（毫秒），见插件 API 文档第 15 节。 */
export const BUDGET_MS: Partial<Record<HookKind, number>> = {
  filter: 1,
  content: 5,
  comment: 5,
}

/** 调用次数达到这个数后，超出预算的比例超过一半就算"持续超标"。 */
const SLOW_MIN_CALLS = 20

/** 一个插件的计时与报错统计，以及熔断判断。 */
export class Monitor {
  private hooks: Partial<Record<HookKind, HookStats>> = {}
  private recentErrors: number[] = []
  private totalErrors = 0

  constructor(
    private readonly windowMs: number,
    private readonly maxErrors: number,
  ) {}

  record(kind: HookKind, ms: number): void {
    let s = this.hooks[kind]
    if (!s) {
      s = { calls: 0, totalMs: 0, maxMs: 0, overBudget: 0 }
      this.hooks[kind] = s
    }
    s.calls++
    s.totalMs += ms
    s.maxMs = Math.max(s.maxMs, ms)
    const budget = BUDGET_MS[kind]
    if (budget !== undefined && ms > budget) s.overBudget++
  }

  /** 记一次报错；时间窗口内的报错超过上限时返回 true，表示应当熔断。 */
  recordError(now: number): boolean {
    this.totalErrors++
    this.recentErrors = this.recentErrors.filter(t => now - t < this.windowMs)
    this.recentErrors.push(now)
    return this.recentErrors.length > this.maxErrors
  }

  /** 重新启用插件时清空熔断计数（累计统计保留）。 */
  resetBreaker(): void {
    this.recentErrors = []
  }

  snapshot(): PluginStats {
    const hooks: Partial<Record<HookKind, HookStats>> = {}
    const slow: HookKind[] = []
    for (const [kind, s] of Object.entries(this.hooks) as [HookKind, HookStats][]) {
      hooks[kind] = { ...s }
      if (s.calls >= SLOW_MIN_CALLS && s.overBudget / s.calls > 0.5) slow.push(kind)
    }
    return { errors: this.totalErrors, hooks, slow }
  }
}
