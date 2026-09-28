// 官方插件"键盘浏览"（shortcuts）：用键盘浏览知乎。j / k 切换内容，o 展开全文，c 收起，Shift+C 收起全部，g g 回到顶部。
// 同样的操作也注册成命令，在命令面板（Ctrl+K / ⌘K）里能搜到；快捷键可以在设置页改键或停用。
//
// 只做浏览，不提供点赞、关注等对知乎的写操作。用到的 z.contents 是 experimental API。

import type { ContentHandle, PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'shortcuts',
  name: '键盘浏览',
  version: '0.1.0',
  api: 1,
  description:
    'j / k 切换内容，o 展开全文，c 收起，g g 回到顶部，命令面板里也能找到这些操作。可以在下面的"快捷键"里改键',
} satisfies PluginMeta

/**
 * 连续按键时，这段时间内以上一次跳到的内容为准：平滑滚动还没停下时，
 * "视口最上面的内容"还没有变成刚跳到的那块。
 */
export const CHAIN_MS = 1000

export default function shortcuts(z: PluginAPI<typeof meta>) {
  let last: { handle: ContentHandle; at: number } | undefined

  /** 当前内容：刚用快捷键跳到的那块，否则是视口最上面的那块 */
  function current(list: readonly ContentHandle[]): ContentHandle | undefined {
    if (last && Date.now() - last.at < CHAIN_MS && list.includes(last.handle)) return last.handle
    return z.contents.current()
  }

  function goTo(handle: ContentHandle): void {
    handle.scrollIntoView()
    last = { handle, at: Date.now() }
  }

  function move(step: 1 | -1): void {
    const list = z.contents.all()
    const from = current(list)
    const index = from ? list.indexOf(from) : -1
    // 视口里已经没有内容（滚过了全部内容）时，往上翻回到最后一块
    const target = index < 0 ? (step < 0 ? list.at(-1) : undefined) : list[index + step]
    if (target) goTo(target)
  }

  function expand(): void {
    current(z.contents.all())?.expand()
  }

  function collapse(): void {
    const handle = current(z.contents.all())
    if (!handle) return
    handle.collapse()
    // 收起后内容变短，把它的开头放回视口顶部
    goTo(handle)
  }

  function collapseAll(): void {
    const list = z.contents.all()
    const keep = current(list)
    for (const handle of list) handle.collapse()
    if (keep) goTo(keep)
  }

  function toTop(): void {
    last = undefined
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 命令的标题和快捷键的说明写成一样，命令面板里会在命令旁边显示快捷键
  const actions = [
    { id: 'next', keys: 'j', title: '下一条内容', keywords: ['向下', 'next'], run: () => move(1) },
    { id: 'previous', keys: 'k', title: '上一条内容', keywords: ['向上', 'previous'], run: () => move(-1) },
    { id: 'expand', keys: 'o', title: '展开当前内容', keywords: ['阅读全文', 'expand'], run: expand },
    { id: 'collapse', keys: 'c', title: '收起当前内容', keywords: ['collapse'], run: collapse },
    { id: 'collapse-all', keys: 'shift+c', title: '收起全部内容', keywords: ['collapse'], run: collapseAll },
    { id: 'top', keys: 'g g', title: '回到顶部', keywords: ['顶部', 'top'], run: toTop },
  ]
  for (const action of actions) {
    z.registerCommand(action.id, { title: action.title, keywords: action.keywords, run: action.run })
    z.registerShortcut(action.keys, action.run, { description: action.title })
  }
}
