// 端到端冒烟测试：在本地模拟的知乎上加载构建好的扩展，检查"屏蔽"插件从头到尾都能工作。
// 用法：pnpm --filter @zhihu-browser/extension build && pnpm --filter @zhihu-browser/extension e2e
// 不访问真实的知乎：用 --host-resolver-rules 把 *.zhihu.com 指向本地服务器。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { MORE_ANSWERS, SSR_ANSWERS, startMockZhihu } from './mock-zhihu.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const extDir = path.resolve(here, '../.output/chrome-mv3')
const PORT = 18_090
const HOME = 'http://www.zhihu.com/'
const QUESTION = 'http://www.zhihu.com/question/9'

if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
  console.error('找不到构建好的扩展，请先运行 pnpm --filter @zhihu-browser/extension build')
  process.exit(1)
}

const server = await startMockZhihu(PORT)
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-e2e-'))
const context = await chromium.launchPersistentContext(userDir, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    `--host-resolver-rules=MAP *.zhihu.com 127.0.0.1:${PORT}`,
  ],
})
// 每一帧记录哪些回答是可见的，用来检查被屏蔽的内容有没有"先显示再隐藏"
await context.addInitScript(() => {
  const shown = new Set()
  window.__shown = shown
  const check = () => {
    for (const el of document.querySelectorAll('.ContentItem[data-zop]')) {
      if (getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0) {
        shown.add(String(JSON.parse(el.dataset.zop).itemId))
      }
    }
    requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
})
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
const extId = new URL(sw.url()).host
const storage = {
  set: items => sw.evaluate(i => chrome.storage.local.set(i), items),
  get: keys => sw.evaluate(k => chrome.storage.local.get(k), keys),
}
const settings = async () => (await storage.get('settings:filter'))['settings:filter'] ?? {}
const setSettings = async values => storage.set({ 'settings:filter': { ...(await settings()), ...values } })

const pageErrors = []
async function open(url) {
  const page = await context.newPage()
  page.on('pageerror', e => pageErrors.push(`${url}: ${e.message}`))
  page.on('console', m => {
    if (m.text().includes('[zhihu-browser]')) pageErrors.push(`${url}: ${m.text()}`)
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
    console.log(
      `✗ ${name}\n  ${String(e?.stack ?? e)
        .split('\n')
        .slice(0, 6)
        .join('\n  ')}`,
    )
  }
}

/** 页面上某张卡片的状态 */
const cardState = (page, key) =>
  page.evaluate(k => {
    const el = document.querySelector(`[data-zb-id="${k}"]`)
    if (!el) return 'missing'
    if (el.closest('[data-zb-hidden]')) return 'hidden'
    const fold = el.getAttribute('data-zb-fold')
    return fold ? `folded:${fold}` : 'shown'
  }, key)

// 按时间轮询：后台标签页里 requestAnimationFrame 可能暂停
const waitFor = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000, polling: 50 })

/** 等到异步条件成立（例如存储里的值） */
async function until(fn, timeout = 5000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error('等待超时')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

// ---------- 首页 ----------

const home = await open(HOME)
await waitFor(home, () => window.__app?.pages === 1 && document.querySelectorAll('[data-zb-id]').length >= 6)

await check('广告在知乎渲染之前就被去掉，内容卡片都被识别', async () => {
  assert.equal(await home.evaluate(() => window.__app.ads), 0)
  assert.equal(await home.evaluate(() => window.__app.rendered), 6)
  const keys = await home.evaluate(() =>
    [...document.querySelectorAll('[data-zb-id]')].map(el => el.getAttribute('data-zb-id')),
  )
  assert.deepEqual(keys, ['answer:11', 'answer:12', 'answer:13', 'answer:14', 'answer:15', 'article:16'])
})

await check('卡片的操作栏里有"屏蔽作者"按钮（在知乎前端激活之后插入）', async () => {
  await waitFor(home, () => document.querySelectorAll('.ContentItem-actions .zb-action').length === 6)
  const labels = await home.evaluate(() => [...document.querySelectorAll('.zb-action')].map(b => b.textContent))
  assert.ok(labels.every(l => l === '屏蔽作者'))
})

await check('添加关键词后，已经显示的卡片立即折叠并显示原因', async () => {
  await setSettings({ keywords: ['营销'] })
  await waitFor(home, () => document.querySelector('[data-zb-id="answer:15"]')?.hasAttribute('data-zb-fold'))
  assert.equal(await cardState(home, 'answer:15'), 'folded:关键词 营销')
  assert.equal(await cardState(home, 'answer:14'), 'shown')
  // 折叠由扩展注入的样式完成：子元素隐藏，伪元素显示原因
  const style = await home.evaluate(() => {
    const el = document.querySelector('[data-zb-id="answer:15"]')
    return { child: getComputedStyle(el.firstElementChild).display, bar: getComputedStyle(el, '::before').content }
  })
  assert.equal(style.child, 'none')
  assert.match(style.bar, /已折叠：关键词 营销/)
})

await check('点击折叠的卡片可以展开', async () => {
  await home.locator('[data-zb-id="answer:15"]').click({ position: { x: 20, y: 10 } })
  assert.equal(
    await home.evaluate(() => document.querySelector('[data-zb-id="answer:15"]').hasAttribute('data-zb-fold-open')),
    true,
  )
})

await check('改成"直接去掉"：命中的卡片隐藏，下一页在接口层过滤', async () => {
  await setSettings({ mode: 'remove' })
  await waitFor(home, () => !!document.querySelector('[data-zb-id="answer:15"]')?.closest('[data-zb-hidden]'))
  await home.evaluate(() => window.__app.loadMore())
  await waitFor(home, () => window.__app.pages === 2)
  // 第 2 页 6 条里 25 号标题带"营销"
  assert.equal(await home.evaluate(() => window.__app.rendered), 11)
  assert.equal(await cardState(home, 'answer:25'), 'missing')
})

await check('"屏蔽作者"：确认后写入设置，同一作者的其他内容随即隐藏', async () => {
  // 12 号的作者是用户1（15 号也是，已经因为关键词隐藏）
  await home.locator('[data-zb-id="answer:12"] .zb-action').click()
  const dialog = home.locator('#zb-root .dialog')
  await dialog.waitFor({ timeout: 5000 })
  // CSP 不允许内联样式，界面样式来自 adoptedStyleSheets
  assert.equal(await home.locator('#zb-root .backdrop').evaluate(el => getComputedStyle(el).position), 'fixed')
  assert.match(await dialog.textContent(), /屏蔽 用户1 的所有内容/)
  await home.locator('#zb-root .dialog button.primary').click()
  await waitFor(home, () => !!document.querySelector('[data-zb-id="answer:12"]')?.closest('[data-zb-hidden]'))
  assert.deepEqual((await settings()).authors, ['用户1 @user-1'])
  assert.match(await home.locator('#zb-root .toast').first().textContent(), /已屏蔽 用户1/)
  assert.equal(await cardState(home, 'answer:21'), 'hidden') // 21 号的作者也是用户1
  assert.equal(await cardState(home, 'answer:13'), 'shown')
})

// ---------- 问题页 ----------

const question = await open(QUESTION)
await waitFor(question, () => window.__app?.xhrItems > 0)

await check('问题页：服务端渲染的回答按作者隐藏，用 XHR 加载的回答在接口层过滤', async () => {
  // 903、906 的作者是用户1
  assert.equal(await cardState(question, 'answer:903'), 'hidden')
  assert.equal(await cardState(question, 'answer:901'), 'shown')
  // 被屏蔽的回答从头到尾没有显示过（预隐藏生效，没有闪烁）
  const shown = await question.evaluate(() => [...window.__shown].sort())
  assert.ok(shown.includes('901') && !shown.includes('903'), `显示过的回答：${shown}`)
  assert.equal(await question.evaluate(() => window.__app.xhrItems), MORE_ANSWERS.length - 1)
  assert.equal(await cardState(question, 'answer:906'), 'missing')
  assert.equal(await cardState(question, 'question:9'), 'shown')
  const done = await question.evaluate(() =>
    [...document.querySelectorAll('.ContentItem')].every(el => el.hasAttribute('data-zb-done')),
  )
  assert.ok(done)
  assert.equal(SSR_ANSWERS.length, 3)
})

// ---------- 设置页 ----------

const options = await open(`chrome-extension://${extId}/options.html`)
await check('设置页显示插件和它的设置项', async () => {
  await options.locator('h2', { hasText: '屏蔽' }).first().waitFor({ timeout: 5000 })
  assert.equal(await options.locator('#filter-keywords').inputValue(), '营销')
  assert.equal(await options.locator('#filter-authors').inputValue(), '用户1 @user-1')
  assert.equal(await options.locator('#filter-mode').inputValue(), 'remove')
})

await check('在设置页修改设置，知乎页面立即应用', async () => {
  await options.locator('#filter-authors').fill('')
  await options.locator('#filter-authors').blur()
  await waitFor(question, () => !document.querySelector('[data-zb-id="answer:903"]')?.closest('[data-zb-hidden]'))
  assert.deepEqual((await settings()).authors, [])
})

await check('停用插件后知乎页面恢复原样', async () => {
  await options.getByRole('switch', { name: '启用屏蔽' }).click()
  await waitFor(home, () => document.querySelectorAll('.zb-action').length === 0)
  assert.equal(await cardState(home, 'answer:15'), 'shown')
  assert.deepEqual((await storage.get('plugins')).plugins, { filter: { enabled: false } })
  await options.getByRole('switch', { name: '启用屏蔽' }).click()
  await waitFor(home, () => document.querySelectorAll('.zb-action').length > 0)
})

// ---------- 命令面板、快捷键、数据包 ----------

const palette = home.locator('#zb-root .palette')
async function runCommand(title) {
  await home.bringToFront()
  await home.keyboard.press('Control+k')
  await palette.waitFor({ timeout: 5000 })
  await home.keyboard.type(title)
  await home.keyboard.press('Enter')
}

await check('命令面板：Ctrl+K 打开，列出内置命令；可以查看快捷键', async () => {
  await home.bringToFront()
  await home.keyboard.press('Control+k')
  await palette.waitFor({ timeout: 5000 })
  const titles = await palette.locator('[role="option"] .title').allTextContents()
  assert.deepEqual(titles, ['查看快捷键', '插件状态与日志', '打开设置页'])
  await home.keyboard.press('Escape')
  await palette.waitFor({ state: 'detached', timeout: 5000 })
  await runCommand('快捷键')
  const sheet = home.locator('#zb-root .sheet')
  await sheet.waitFor({ timeout: 5000 })
  assert.match(await sheet.textContent(), /打开命令面板/)
  assert.deepEqual(await sheet.locator('kbd').allTextContents(), ['Ctrl+K'])
  await home.keyboard.press('Escape')
})

await check('命令面板：插件状态与日志', async () => {
  await runCommand('插件状态')
  const row = home.locator('#zb-root .sheet .row').first()
  await row.waitFor({ timeout: 5000 })
  assert.match(await row.textContent(), /屏蔽.*运行中/)
  await home.keyboard.press('Escape')
})

await check('在设置页改命令面板的快捷键，知乎页面立即生效', async () => {
  const registry = (await storage.get('registry')).registry
  assert.deepEqual(
    registry.shortcuts.map(s => s.id),
    ['@host:mod+k'],
  )
  assert.match(await options.textContent('body'), /已启用的插件没有注册快捷键/)
  await options.locator('#palette-keys').fill('alt+p')
  await options.locator('#palette-keys').blur()
  await until(async () => (await storage.get('paletteKeys')).paletteKeys === 'alt+p')
  await home.bringToFront()
  await home.keyboard.press('Control+k')
  await home.waitForTimeout(200)
  assert.equal(await palette.count(), 0)
  await home.keyboard.press('Alt+p')
  await palette.waitFor({ timeout: 5000 })
  await home.keyboard.press('Escape')
  await options.getByRole('button', { name: '恢复默认', exact: true }).click()
  await until(async () => (await storage.get('paletteKeys')).paletteKeys === 'mod+k')
})

await check('数据包：导出当前设置；导入前先预览，导入后知乎页面立即应用', async () => {
  const [download] = await Promise.all([
    options.waitForEvent('download'),
    options.getByRole('button', { name: '导出为数据包' }).click(),
  ])
  assert.equal(download.suggestedFilename(), 'zhihu-browser-filter.json')
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'))
  assert.deepEqual(exported.settings, { mode: 'remove', keywords: ['营销'] })

  const pack = { zbPack: 1, plugin: 'filter', name: '示例屏蔽列表', settings: { authors: ['用户3 @user-3'] } }
  await options.locator('input[type="file"]').setInputFiles({
    name: 'pack.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(pack)),
  })
  const preview = options.locator('section.pack-preview')
  await preview.waitFor({ timeout: 5000 })
  assert.match(await preview.textContent(), /屏蔽作者：新增 1 项：用户3 @user-3/)
  assert.equal(await cardState(home, 'answer:14'), 'shown')
  await preview.getByRole('button', { name: '导入' }).click()
  // 14 号的作者是用户3
  await waitFor(home, () => !!document.querySelector('[data-zb-id="answer:14"]')?.closest('[data-zb-hidden]'))
  assert.deepEqual((await settings()).authors, ['用户3 @user-3'])
})

await check('安全模式：刷新后不运行任何插件', async () => {
  await options.getByRole('switch', { name: '安全模式' }).click()
  await waitFor(home, () =>
    [...(document.querySelector('#zb-root')?.shadowRoot?.querySelectorAll('.toast') ?? [])].some(t =>
      t.textContent.includes('安全模式在刷新页面后生效'),
    ),
  )
  const fresh = await open(HOME)
  await waitFor(fresh, () => window.__app?.pages === 1 && document.querySelectorAll('[data-zb-id]').length > 0)
  assert.equal(await fresh.evaluate(() => window.__app.ads), 1)
  assert.equal(await fresh.evaluate(() => document.querySelectorAll('.zb-action').length), 0)
  await storage.set({ safeMode: false })
})

await check('页面上没有报错', async () => {
  assert.deepEqual(pageErrors, [])
})

await context.close()
await server.close()
fs.rmSync(userDir, { recursive: true, force: true })
console.log(failed ? `\n${failed} 项检查失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
