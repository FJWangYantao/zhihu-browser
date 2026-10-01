// 用户插件的端到端测试：在本地模拟的知乎上，通过 chrome.userScripts 运行用户插件。
// 用法：pnpm --filter @zhihu-browser/extension build && pnpm --filter @zhihu-browser/extension e2e:user
// 自动在 chrome://extensions 里打开"允许用户脚本"（Chrome 138+ 的开关）。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startMockZhihu } from './mock-zhihu.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const extDir = path.resolve(here, '../.output/chrome-mv3')
const PORT = 18_091
const HOME = 'http://www.zhihu.com/'

if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
  console.error('找不到构建好的扩展，请先运行 pnpm --filter @zhihu-browser/extension build')
  process.exit(1)
}

const server = await startMockZhihu(PORT)
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-e2e-user-'))
const context = await chromium.launchPersistentContext(userDir, {
  channel: process.env.SMOKE_CHANNEL ?? 'chromium',
  headless: true,
  timezoneId: 'Asia/Shanghai',
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    `--host-resolver-rules=MAP *.zhihu.com 127.0.0.1:${PORT}`,
  ],
})
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
const extId = new URL(sw.url()).host
const storage = {
  set: items => sw.evaluate(i => chrome.storage.local.set(i), items),
  get: keys => sw.evaluate(k => chrome.storage.local.get(k), keys),
}

const problems = []
async function open(url) {
  const page = await context.newPage()
  page.on('pageerror', e => problems.push(`${url}: ${e.message}`))
  page.on('console', m => {
    if (m.text().includes('[zhihu-browser]')) problems.push(`${url}: ${m.text()}`)
  })
  await page.goto(url)
  return page
}

let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    failed++
    if (process.env.DEBUG_E2E && home) {
      console.log(
        await home.evaluate(() => document.querySelector('[data-zb-id="answer:11"]')?.outerHTML.slice(0, 1500)),
      )
      console.log(await home.evaluate(() => document.querySelector('#zb-root')?.shadowRoot?.innerHTML.slice(0, 1500)))
    }
    console.log(
      `✗ ${name}\n  ${String(e?.stack ?? e)
        .split('\n')
        .slice(0, 6)
        .join('\n  ')}`,
    )
  }
}

/** 用户插件加的标签（官方的"信息增强"也会加标签，按文字区分） */
const badgeTexts = (page, text) =>
  page.evaluate(t => [...document.querySelectorAll('.zb-badge')].filter(b => b.textContent === t).length, text)

const waitFor = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 8000, polling: 50 })
async function until(fn, timeout = 8000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error('等待超时')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** 设置页（扩展自己的页面）：向后台发管理消息，和设置页界面做的一样 */
const settingsPage = await open(`chrome-extension://${extId}/options.html`)
const manage = request =>
  settingsPage.evaluate(r => chrome.runtime.sendMessage({ type: 'user-plugins', request: r }), request)
const install = async source => {
  const reply = await manage({ op: 'install', source, fileName: 'plugin.ts' })
  assert.equal(reply.ok, true, JSON.stringify(reply))
  return reply.value
}

/** 在 chrome://extensions 里打开或关闭"允许用户脚本" */
async function setUserScriptsToggle(on) {
  const page = await context.newPage()
  await page.goto(`chrome://extensions/?id=${extId}`)
  const toggle = page.locator('#allow-user-scripts')
  await toggle.waitFor({ timeout: 8000 })
  const checked = await toggle.evaluate(el => el.checked)
  if (checked !== on) await toggle.click()
  await page.close()
}

const PLUGIN = (version, drop) => `
import type { PluginAPI, PluginMeta } from '@zhihu-browser/sdk'

export const meta = {
  id: 'e2e-plugin',
  name: '端到端插件',
  version: '${version}',
  api: 1,
  settings: {
    badge: { type: 'string', label: '标签文字', default: '用户插件' },
  },
} satisfies PluginMeta

console.log('[e2e-top] top-level ran')

export default function (z: PluginAPI<typeof meta>) {
  z.filter('feed', item => item.content?.id !== '${drop}')
  z.on('content', (content, ctx) => {
    ctx.ui.badge(z.settings.get('badge'), { tone: 'info' })
    ctx.el.setAttribute('data-e2e-seen', content.id)
    ctx.ui.addAction({ label: '用户按钮', onClick: () => z.ui.toast('点击了 ' + content.id) })
  })
  z.registerCommand('read-setting', {
    title: '用户插件：读设置',
    run: () => z.ui.toast('设置是 ' + z.settings.get('badge')),
  })
  z.registerCommand('ping', {
    title: '用户插件：存取',
    run: async () => {
      await z.storage.set('k', { n: 1 })
      const v = await z.storage.get<{ n: number }>('k')
      z.ui.toast('存取 ' + v?.n)
    },
  })
  z.addStyle('body { --e2e-style: 1 }')
  z.log.info('已启动')
}
`

// ---------- 没有开启"允许用户脚本"时 ----------

await check('没有开启"允许用户脚本"：插件照样保存，知乎页面上提示原因', async () => {
  const status = await manage({ op: 'status' })
  assert.deepEqual(status.value, { available: false })
  const result = await install(PLUGIN('1.0.0', '13'))
  assert.equal(result.scriptsAvailable, false)
  assert.equal(result.entry.enabled, true)
  // 设置页上有"允许用户脚本"的引导，已安装的插件显示成卡片
  await settingsPage.reload()
  await settingsPage.locator('.guide').waitFor({ timeout: 8000 })
  assert.match(await settingsPage.locator('.guide').textContent(), /允许用户脚本/)
  await settingsPage
    .locator('section.card', { has: settingsPage.locator('.user-footer') })
    .first()
    .waitFor({ timeout: 8000 })
  const home = await open(HOME)
  await waitFor(home, () => window.__app?.pages === 1 && document.querySelectorAll('[data-zb-id]').length >= 6)
  await home.keyboard.press('Control+k')
  await home.locator('#zb-root .palette').waitFor({ timeout: 5000 })
  await home.keyboard.type('插件状态')
  await home.keyboard.press('Enter')
  const rows = home.locator('#zb-root .sheet .row')
  await rows.first().waitFor({ timeout: 5000 })
  await until(async () => /端到端插件.*出错停用/.test((await rows.allTextContents()).join('\n')), 12000)
  assert.match((await rows.allTextContents()).join('\n'), /允许用户脚本/)
  // 没有开启时，插件的代码一行也没有执行
  assert.equal(await home.evaluate(() => document.querySelectorAll('[data-e2e-seen]').length), 0)
  await home.close()
})

// ---------- 打开之后 ----------

await check('打开"允许用户脚本"：回到设置页，脚本自动注册', async () => {
  await setUserScriptsToggle(true)
  const status = await manage({ op: 'status' })
  assert.deepEqual(status.value, { available: true })
  // 回到设置页时自动重新检查，引导消失
  await settingsPage.bringToFront()
  await settingsPage.evaluate(() => window.dispatchEvent(new Event('focus')))
  await settingsPage.locator('.guide').waitFor({ state: 'detached', timeout: 8000 })
  const scripts = await sw.evaluate(() => chrome.userScripts.getScripts())
  assert.deepEqual(
    scripts.map(s => s.id),
    ['zb-e2e-plugin'],
  )
})

let home
await check('用户插件的过滤函数在知乎渲染之前生效', async () => {
  home = await open(HOME)
  await waitFor(home, () => window.__app?.pages === 1 && document.querySelectorAll('[data-zb-id]').length >= 5)
  const keys = await home.evaluate(() =>
    [...document.querySelectorAll('[data-zb-id]')].map(el => el.getAttribute('data-zb-id')),
  )
  assert.deepEqual(keys, ['answer:11', 'answer:12', 'answer:14', 'answer:15', 'article:16'])
})

await check('渲染钩子：标签、按钮、页面元素；设置、样式、日志', async () => {
  await until(async () => (await badgeTexts(home, '用户插件')) === 5)
  assert.equal(await home.evaluate(() => document.querySelectorAll('[data-e2e-seen]').length), 5)
  assert.equal(await home.evaluate(() => getComputedStyle(document.body).getPropertyValue('--e2e-style').trim()), '1')
  // 设置在别处被修改：用户插件里同步读到的是新值
  await storage.set({ 'settings:e2e-plugin': { badge: '改过了' } })
  await home.bringToFront()
  await home.keyboard.press('Control+k')
  await home.locator('#zb-root .palette').waitFor({ timeout: 5000 })
  await home.keyboard.type('读设置')
  await home.keyboard.press('Enter')
  await home.locator('#zb-root .toast', { hasText: '设置是 改过了' }).waitFor({ timeout: 5000 })
})

await check('按钮点击回到用户插件；命令用到存储', async () => {
  await home.bringToFront()
  await home.locator('[data-zb-id="answer:11"] .zb-action', { hasText: '用户按钮' }).click()
  await home.locator('#zb-root .toast', { hasText: '点击了 11' }).waitFor({ timeout: 5000 })
  // 焦点还在刚点过的按钮上（我们自己的界面），快捷键不处理：先让它失去焦点
  await home.evaluate(() => document.activeElement?.blur())
  await home.keyboard.press('Control+k')
  await home.locator('#zb-root .palette').waitFor({ timeout: 5000 })
  await home.keyboard.type('存取')
  await home.keyboard.press('Enter')
  await home.locator('#zb-root .toast', { hasText: '存取 1' }).waitFor({ timeout: 5000 })
  assert.deepEqual((await storage.get('data:e2e-plugin:k'))['data:e2e-plugin:k'], { n: 1 })
})

await check('页面脚本看不到用户插件的运行环境', async () => {
  const leaked = await home.evaluate(() => ({
    runtimes: typeof window.__zbRuntimes,
    boot: typeof window.__zbBoot,
    seen: Object.keys(window).filter(k => /zb|e2e/i.test(k)),
  }))
  assert.equal(leaked.runtimes, 'undefined')
  assert.equal(leaked.boot, 'undefined')
  assert.deepEqual(
    leaked.seen.filter(k => k !== '__shown'),
    [],
  )
})

await check('热重载：更新插件后，已打开的页面不用刷新就换成新代码', async () => {
  const result = await install(PLUGIN('1.0.1', '14'))
  assert.equal(result.plan.action, 'update')
  await waitFor(
    home,
    () =>
      !!document.querySelector('[data-zb-id="answer:14"]')?.closest('[data-zb-hidden]') ||
      !document.querySelector('[data-zb-id="answer:14"]'),
  )
  // 新代码里 13 号不再被过滤：下一页的数据里没有它，只检查 14 号被去掉
  assert.equal(
    await home.evaluate(() => {
      const el = document.querySelector('[data-zb-id="answer:14"]')
      return !el || !!el.closest('[data-zb-hidden]')
    }),
    true,
  )
})

await check('停用：页面上的标签和过滤立即撤销', async () => {
  await manage({ op: 'set-enabled', id: 'e2e-plugin', enabled: false })
  await until(async () => (await badgeTexts(home, '改过了')) === 0)
  const scripts = await sw.evaluate(() => chrome.userScripts.getScripts())
  assert.deepEqual(scripts, [])
  await manage({ op: 'set-enabled', id: 'e2e-plugin', enabled: true })
  await until(async () => (await badgeTexts(home, '改过了')) > 0)
})

await check('安全模式：用户插件什么也不运行，文件顶层的代码也不执行', async () => {
  await storage.set({ safeMode: true })
  const page = await context.newPage()
  const logs = []
  page.on('console', m => logs.push(m.text()))
  await page.goto(HOME)
  await waitFor(page, () => window.__app?.pages === 1)
  await page.waitForTimeout(800)
  assert.equal(await badgeTexts(page, '改过了'), 0)
  assert.ok(!logs.some(l => l.includes('[e2e-top]')), logs.join('|'))
  await storage.set({ safeMode: false })
  await page.close()
})

await check('卸载：索引、源码、设置、数据、注册的脚本都被清掉', async () => {
  await manage({ op: 'uninstall', id: 'e2e-plugin' })
  await until(async () => (await badgeTexts(home, '改过了')) === 0)
  const all = Object.keys(await storage.get(null))
  assert.deepEqual(
    all.filter(k => k.includes('e2e-plugin')),
    [],
  )
  assert.deepEqual(await sw.evaluate(() => chrome.userScripts.getScripts()), [])
})

await check('用户插件不能和官方插件重名；内容不合法时给出原因', async () => {
  const dup = await manage({
    op: 'install',
    source: `export const meta = { id: 'filter', name: 'x', version: '1.0.0', api: 1 }\nexport default function () {}`,
  })
  assert.equal(dup.ok, false)
  assert.match(dup.error, /官方插件/)
  const bad = await manage({
    op: 'install',
    source: `const id = 'a'\nexport const meta = { id }\nexport default function () {}`,
  })
  assert.equal(bad.ok, false)
  assert.ok(bad.problems.length > 0)
})

await check('设置页：粘贴安装（先确认）、卡片里改设置、停用、卸载', async () => {
  await settingsPage.bringToFront()
  await settingsPage.reload()
  await settingsPage.locator('#plugin-source').fill(PLUGIN('2.0.0', '12'))
  await settingsPage.getByRole('button', { name: '检查并安装' }).click()
  const review = settingsPage.locator('.review')
  await review.waitFor({ timeout: 8000 })
  assert.match(await review.textContent(), /安装「端到端插件」/)
  assert.match(await review.textContent(), /不访问任何外部网络/)
  assert.match(await review.locator('pre.source').textContent(), /export default function/)
  // 确认之前什么也没有安装
  assert.deepEqual(Object.keys((await storage.get('userPlugins')).userPlugins ?? {}), [])
  await settingsPage.getByRole('button', { name: '确认安装' }).click()
  const card = settingsPage.locator('section.card', { has: settingsPage.locator('.user-footer') }).first()
  await card.waitFor({ timeout: 8000 })
  assert.match(await card.textContent(), /用户插件 · id：e2e-plugin/)
  await card.locator('#e2e-plugin-badge').fill('从设置页改的')
  await card.locator('#e2e-plugin-badge').blur()
  await until(async () => (await storage.get('settings:e2e-plugin'))['settings:e2e-plugin']?.badge === '从设置页改的')
  // 已打开的知乎页面：新装的插件立即开始运行
  await home.bringToFront()
  await until(async () => (await badgeTexts(home, '用户插件')) + (await badgeTexts(home, '从设置页改的')) > 0)
  await settingsPage.bringToFront()
  await card.locator('input[role="switch"]').evaluate(el => el.click())
  await until(async () => !(await storage.get('userPlugins')).userPlugins['e2e-plugin'].enabled)
  await card.getByRole('button', { name: '卸载' }).click()
  await card.getByRole('button', { name: '确认卸载' }).click()
  await settingsPage.locator('section.card .user-footer').waitFor({ state: 'detached', timeout: 8000 })
  assert.deepEqual(Object.keys((await storage.get('userPlugins')).userPlugins ?? {}), [])
})

// M2 验收：任意一个官方插件以用户插件方式安装后，行为与内置时一致。
// 官方插件的源码本身就是合法的单文件插件：改个 id 直接安装，和内置的版本对比页面上的结果。
await check('官方插件（屏蔽、信息增强）以用户插件方式安装后，页面上的行为与内置时一致', async () => {
  const pluginsDir = path.resolve(here, '../../../plugins')
  const sourceOf = (name, copy) =>
    fs.readFileSync(path.join(pluginsDir, name, 'src/index.ts'), 'utf8').replace(`id: '${name}',`, `id: '${copy}',`)
  const snapshot = page =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-zb-id]')].map(el => ({
        id: el.getAttribute('data-zb-id'),
        state: el.closest('[data-zb-hidden]') ? 'hidden' : (el.getAttribute('data-zb-fold') ?? 'shown'),
        badges: [...el.querySelectorAll('.zb-badge')].map(b => b.textContent),
        actions: [...el.querySelectorAll('.zb-action')].map(b => b.textContent),
      })),
    )
  /** 打开首页，等官方（或用户）插件的标签和按钮都出现 */
  const stable = async () => {
    const page = await open(HOME)
    await waitFor(page, () => window.__app?.pages === 1 && document.querySelectorAll('[data-zb-id]').length >= 6)
    await until(async () => {
      const cards = await snapshot(page)
      return (
        cards.length >= 6 && cards.every(c => c.badges.length >= 1 && (c.actions.length >= 1 || c.state !== 'shown'))
      )
    }, 12_000).catch(async e => {
      console.log(JSON.stringify(await snapshot(page)))
      throw e
    })
    const cards = await snapshot(page)
    await page.close()
    return cards
  }

  const rules = { keywords: ['营销'], mode: 'fold' }
  await storage.set({ 'settings:filter': rules, 'settings:filter-copy': rules })
  const builtin = await stable()
  assert.ok(
    builtin.some(c => c.state.startsWith('关键词')),
    '内置的屏蔽应当折叠了带"营销"的卡片',
  )
  assert.ok(
    builtin.every(c => c.badges.some(b => /字$/.test(b))),
    '内置的信息增强应当显示字数',
  )

  await storage.set({ plugins: { filter: { enabled: false }, info: { enabled: false } } })
  await install(sourceOf('filter', 'filter-copy'))
  await install(sourceOf('info', 'info-copy'))
  const copied = await stable()
  assert.deepEqual(copied, builtin)

  await manage({ op: 'uninstall', id: 'filter-copy' })
  await manage({ op: 'uninstall', id: 'info-copy' })
  await storage.set({ plugins: { filter: { enabled: true }, info: { enabled: true } } })
})

await check('页面上没有报错', async () => {
  assert.deepEqual(problems, [])
})

await context.close()
await server.close()
if (failed) {
  console.log(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
