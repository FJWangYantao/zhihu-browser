// 端到端冒烟测试：在本地模拟的知乎上加载构建好的扩展，检查官方插件从头到尾都能工作。
// 用法：pnpm --filter @zhihu-browser/extension build && pnpm --filter @zhihu-browser/extension e2e
// 不访问真实的知乎：用 --host-resolver-rules 把 *.zhihu.com 指向本地服务器。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { body, MORE_ANSWERS, SSR_ANSWERS, startMockZhihu } from './mock-zhihu.mjs'

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
  // SMOKE_CHANNEL=msedge 可以用 Edge 跑同一套检查（M1 的 Edge 验证）
  channel: process.env.SMOKE_CHANNEL ?? 'chromium',
  headless: true,
  // 信息增强按本地时区显示时间
  timezoneId: 'Asia/Shanghai',
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
/** 设置页（在"设置页"一节打开） */
let options
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

/** 设置页里某个插件的卡片 */
const pluginCard = name =>
  options.locator('section.card').filter({ has: options.locator('h2', { hasText: new RegExp(`^${name}`) }) })

/** 快捷键插件注册的快捷键和说明 */
const SHORTCUTS = [
  ['j', '下一条内容'],
  ['k', '上一条内容'],
  ['o', '展开当前内容'],
  ['c', '收起当前内容'],
  ['shift+c', '收起全部内容'],
  ['g g', '回到顶部'],
]

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

options = await open(`chrome-extension://${extId}/options.html`)
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

await check('命令面板：Ctrl+K 打开，列出插件命令和内置命令；可以查看快捷键', async () => {
  await home.bringToFront()
  await home.keyboard.press('Control+k')
  await palette.waitFor({ timeout: 5000 })
  const titles = await palette.locator('[role="option"] .title').allTextContents()
  assert.deepEqual(titles, [
    ...SHORTCUTS.map(([, title]) => title),
    '查看快捷键',
    '插件状态与日志',
    '打开设置页',
    '页面结构诊断',
    '采集页面样本',
  ])
  // 命令和快捷键的标题相同：命令旁边显示快捷键
  assert.equal(await palette.locator('[role="option"]').first().locator('kbd').textContent(), 'J')
  await home.keyboard.press('Escape')
  await palette.waitFor({ state: 'detached', timeout: 5000 })
  await runCommand('快捷键')
  const sheet = home.locator('#zb-root .sheet')
  await sheet.waitFor({ timeout: 5000 })
  assert.match(await sheet.textContent(), /打开命令面板.*下一条内容/)
  assert.deepEqual(await sheet.locator('kbd').allTextContents(), ['Ctrl+K', 'J', 'K', 'O', 'C', 'Shift+C', 'G G'])
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
    ['@host:mod+k', ...SHORTCUTS.map(([keys]) => `shortcuts:${keys}`)],
  )
  assert.equal(await options.locator('[id="shortcut-shortcuts:g g"]').inputValue(), 'g g')
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
    pluginCard('屏蔽').getByRole('button', { name: '导出为数据包' }).click(),
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

// ---------- 信息增强、主题、键盘浏览 ----------

await check('设置页：列出四个官方插件，设置项按插件的定义生成', async () => {
  const titles = await options
    .locator('section.card h2')
    .evaluateAll(els => els.map(el => el.firstChild.textContent.trim()))
  assert.deepEqual(titles, ['屏蔽', '主题', '信息增强', '键盘浏览', '快捷键', '数据包', '安全模式'])
  assert.deepEqual(await options.locator('#theme-colorScheme option').allTextContents(), [
    '跟随知乎',
    '浅色',
    '暗色',
    '跟随系统',
  ])
  assert.equal(await options.locator('#info-timeFormat').inputValue(), 'datetime')
  // 键盘浏览没有设置项；它的快捷键列在"快捷键"里
  assert.equal(await pluginCard('键盘浏览').locator('.fields').count(), 0)
  const group = options.locator('.shortcut-group', { has: options.locator('h3', { hasText: '键盘浏览' }) })
  assert.deepEqual(
    await group.locator('label').allTextContents(),
    SHORTCUTS.map(([, title]) => title),
  )
})

await check('信息增强：内容标题旁显示完整的发布时间和字数', async () => {
  const badges = await home
    .locator('[data-zb-id="answer:13"] .ContentItem-title .zb-badge')
    .evaluateAll(els => els.map(el => `${el.textContent}|${el.getAttribute('data-tone')}`))
  // 模拟数据的发布时间是 2023-11-14 22:13:20 UTC（北京时间 2023-11-15 06:13:20），没有编辑过
  const words = body(13)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '').length
  assert.deepEqual(badges, ['发布于 2023-11-15 06:13|muted', `${words} 字|muted`])
  // 问题页顶部的问题显示提问时间：模拟数据里没有，就不显示
  assert.equal(await question.locator('.QuestionHeader .zb-badge').count(), 0)
})

/** 问题页上和主题有关的样式 */
const look = page =>
  page.evaluate(() => {
    const css = selector => getComputedStyle(document.querySelector(selector))
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      fontSize: css('.RichText').fontSize,
      main: Math.round(document.querySelector('.Question-mainColumn').getBoundingClientRect().width),
      sidebar: css('.Question-sideColumn').display,
      header: css('.AppHeader').backgroundColor,
    }
  })
const setTheme = values => storage.set({ 'settings:theme': values })

await check('主题：暗色、字号、主栏宽度、隐藏右侧栏立即生效，停用后恢复原样', async () => {
  const zhihu = { theme: null, fontSize: '15px', main: 694, sidebar: 'block', header: 'rgb(255, 255, 255)' }
  assert.deepEqual(await look(question), zhihu)
  await setTheme({ colorScheme: 'dark', fontSize: '18px', contentWidth: '960px', hideSidebar: true })
  await waitFor(question, () => document.documentElement.getAttribute('data-theme') === 'dark')
  assert.deepEqual(await look(question), {
    theme: 'dark',
    fontSize: '18px',
    main: 960,
    sidebar: 'none',
    header: 'rgb(26, 26, 26)',
  })
  assert.equal(await question.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark')
  // 设置页显示当前的设置
  assert.equal(await options.locator('#theme-colorScheme').inputValue(), 'dark')
  // 界面层（命令面板等）跟随暗色
  await question.bringToFront()
  await question.keyboard.press('Control+k')
  await question.locator('#zb-root .palette').waitFor({ timeout: 5000 })
  assert.equal(await question.evaluate(() => document.getElementById('zb-root').classList.contains('dark')), true)
  await question.keyboard.press('Escape')

  await options.getByRole('switch', { name: '启用主题' }).click()
  await waitFor(question, () => !document.documentElement.hasAttribute('data-theme'))
  assert.deepEqual(await look(question), zhihu)
  await options.getByRole('switch', { name: '启用主题' }).click()
  await waitFor(question, () => document.documentElement.getAttribute('data-theme') === 'dark')
})

await check('主题：跟随系统的浅色 / 暗色', async () => {
  await setTheme({ colorScheme: 'system' })
  await waitFor(question, () => document.documentElement.getAttribute('data-theme') === 'light')
  await question.emulateMedia({ colorScheme: 'dark' })
  await waitFor(question, () => document.documentElement.getAttribute('data-theme') === 'dark')
  await question.emulateMedia({ colorScheme: 'light' })
  await waitFor(question, () => document.documentElement.getAttribute('data-theme') === 'light')
  await setTheme({})
  await waitFor(question, () => !document.documentElement.hasAttribute('data-theme'))
  assert.equal((await look(question)).fontSize, '15px')
})

await check('暗色补丁：评论区、加载中的占位、右下角按钮、导航栏文字没跟着变暗时补上', async () => {
  await question.bringToFront()
  const colors = () =>
    question.evaluate(() => {
      const css = (selector, name) => getComputedStyle(document.querySelector(selector))[name]
      return {
        text: css('.css-ctext', 'color'),
        author: css('.css-cauthor', 'color'),
        head: css('.css-chead', 'color'),
        meta: css('.css-cmeta', 'color'),
        sort: css('.css-sort', 'backgroundColor'),
        border: css('.css-cbox', 'borderTopColor'),
        corner: css('.css-corner', 'backgroundColor'),
        icon: css('.css-corner', 'color'),
        tab: css('.css-tab', 'color'),
      }
    })
  assert.equal((await colors()).text, 'rgb(18, 18, 18)')
  await setTheme({ colorScheme: 'dark' })
  await waitFor(question, () => getComputedStyle(document.querySelector('.css-ctext')).color === 'rgb(211, 211, 211)')
  assert.deepEqual(await colors(), {
    text: 'rgb(211, 211, 211)',
    author: 'rgb(211, 211, 211)',
    head: 'rgb(211, 211, 211)',
    // 次要文字本来就看得清，不动
    meta: 'rgb(133, 144, 166)',
    sort: 'rgb(31, 31, 31)',
    border: 'rgb(58, 58, 58)',
    corner: 'rgb(31, 31, 31)',
    icon: 'rgb(211, 211, 211)',
    tab: 'rgb(211, 211, 211)',
  })
  // 加载中的占位：插入之后、绘制之前就已经是暗色，不会先闪白
  const skeleton = await question.evaluate(
    () =>
      new Promise(resolve => {
        const el = document.createElement('div')
        el.className = 'css-skeleton'
        document.getElementById('answers').append(el)
        requestAnimationFrame(() => resolve(getComputedStyle(el).backgroundColor))
      }),
  )
  assert.equal(skeleton, 'rgb(31, 31, 31)')
  // 跟随知乎：去掉所有补丁
  await setTheme({})
  await waitFor(question, () => getComputedStyle(document.querySelector('.css-ctext')).color === 'rgb(18, 18, 18)')
  const left = await question.evaluate(
    () => document.querySelectorAll('[data-zb-dark-bg], [data-zb-dark-text], [data-zb-dark-border]').length,
  )
  assert.equal(left, 0)
})

await check('主题：右侧栏的类名对不上时，按位置找到并隐藏', async () => {
  // 模拟的首页右侧栏只有自动生成的类名，主栏外面还包着一层
  const sidebar = () => home.evaluate(() => getComputedStyle(document.querySelector('.css-1qyytj7')).display)
  assert.equal(await sidebar(), 'block')
  await setTheme({ hideSidebar: true })
  await waitFor(home, () => getComputedStyle(document.querySelector('.css-1qyytj7')).display === 'none')
  // 外框收缩到主栏的宽度并居中
  const gap = await home.evaluate(() => {
    const r = document.querySelector('.Topstory-mainColumn').getBoundingClientRect()
    return Math.round(r.left - (document.documentElement.clientWidth - r.right))
  })
  assert.ok(Math.abs(gap) <= 1, `主栏左右两边的空白相差 ${gap}px`)
  await setTheme({})
  await waitFor(home, () => getComputedStyle(document.querySelector('.css-1qyytj7')).display === 'block')
})

await check('命令面板：页面结构诊断，只有标签名、类名和尺寸', async () => {
  await runCommand('页面结构诊断')
  const report = home.locator('#zb-root .sheet textarea')
  await report.waitFor({ timeout: 5000 })
  const text = await report.inputValue()
  assert.match(text, /页面类型：home/)
  assert.match(text, /\.Topstory-mainColumn {2}1\n/)
  // 右侧栏作为主栏那一支的兄弟元素列出来
  assert.match(text, /· div\.css-1qyytj7(\[data-zb-side\])? {2}\d+×\d+ block/)
  for (const secret of ['普通问题', '用户1', 'user-1', 'answer:1', 'zhihu.com'])
    assert.ok(!text.includes(secret), secret)
  await home.keyboard.press('Escape')
})

await check('命令面板：采集页面样本，脱敏、保留结构和位置，通过脱敏检查', async () => {
  await runCommand('采集页面样本')
  const report = home.locator('#zb-root .sheet textarea')
  await report.waitFor({ timeout: 5000 }).catch(async e => {
    throw new Error(`${e.message.split('\n')[0]}；提示：${await home.locator('#zb-root .toast').allTextContents()}`)
  })
  const text = await report.inputValue()
  const sample = JSON.parse(text)
  assert.equal(sample.format, 1)
  assert.equal(sample.url, 'https://www.zhihu.com/')
  const html = sample.html.join('')
  // 结构保留：类名、按钮文字、位置
  assert.match(html, /class="Topstory-mainColumn"/)
  assert.match(html, /class="css-1qyytj7"/)
  assert.match(html, /data-rect="\d+,\d+,\d+,\d+"/)
  assert.ok(sample.expect.contents > 0, '没有采到内容元素')
  // 真实的 Chromium 里按位置找得到右侧栏
  assert.equal(sample.expect.columns, true)
  // 文字、作者、标识、我们自己的界面都不在样本里
  for (const secret of ['普通问题', '营销号', '回答正文', 'a1hash', 'data-zb', 'zb-root', '<script', '<style'])
    assert.ok(!text.includes(secret), secret)
  // 作者名、内容 id 换成了编号（作者从 用户1 起，id 从 100001 起，和模拟页面上原来的名字和 id 都不同）
  assert.match(html, /authorName&quot;:&quot;用户\d+&quot;/)
  assert.match(html, /itemId&quot;:1\d{5}/)
  assert.deepEqual(
    sample.entities.filter(k => !/^[a-z]+:\d{6}$/.test(k)),
    [],
  )
  await home.keyboard.press('Escape')
})

/** 页面上显示着的内容，按顺序 */
const shownKeys = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-zb-id]')]
      .filter(el => el.getClientRects().length > 0 && !el.hasAttribute('data-zb-fold'))
      .map(el => el.getAttribute('data-zb-id')),
  )
/** 等到某块内容滚动到视口顶部（让开导航栏） */
const waitAtTop = (page, key) =>
  waitFor(page, k => Math.abs(document.querySelector(`[data-zb-id="${k}"]`).getBoundingClientRect().top - 60) < 2, key)
const collapsed = (page, key) =>
  page.evaluate(k => document.querySelector(`[data-zb-id="${k}"] .RichContent`).classList.contains('is-collapsed'), key)

await check('键盘浏览：j / k 切换内容，o / c 展开收起，g g 回到顶部', async () => {
  await question.bringToFront()
  await question.evaluate(() => window.scrollTo(0, 0))
  const keys = await shownKeys(question)
  assert.equal(keys[0], 'question:9')
  assert.ok(keys.length >= 4, `显示着的内容：${keys}`)
  await question.keyboard.press('j')
  await waitAtTop(question, keys[1])
  await question.keyboard.press('j')
  await waitAtTop(question, keys[2])
  await question.keyboard.press('k')
  await waitAtTop(question, keys[1])

  assert.equal(await collapsed(question, keys[1]), true)
  await question.keyboard.press('o')
  await waitFor(question, k => !document.querySelector(`[data-zb-id="${k}"] .RichContent.is-collapsed`), keys[1])
  await question.keyboard.press('c')
  await waitFor(question, k => !!document.querySelector(`[data-zb-id="${k}"] .RichContent.is-collapsed`), keys[1])

  await question.keyboard.press('g')
  await question.keyboard.press('g')
  await waitFor(question, () => window.scrollY === 0)
  // 输入框里按键不触发
  await question.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'typing'
    document.querySelector('.QuestionHeader').append(input)
  })
  await question.locator('#typing').focus()
  await question.keyboard.press('j')
  await question.waitForTimeout(300)
  assert.equal(await question.evaluate(() => window.scrollY), 0)
  await question.locator('#typing').evaluate(el => el.remove())
})

await check('键盘浏览：在设置页改键后立即生效', async () => {
  const input = options.locator('[id="shortcut-shortcuts:j"]')
  await input.fill('n')
  await input.blur()
  await until(async () => (await storage.get('keymap')).keymap?.['shortcuts:j'] === 'n')
  await question.bringToFront()
  const keys = await shownKeys(question)
  await question.keyboard.press('j')
  await question.waitForTimeout(300)
  assert.equal(await question.evaluate(() => window.scrollY), 0)
  await question.keyboard.press('n')
  await waitAtTop(question, keys[1])
  await options.locator('.shortcut', { has: input }).getByRole('button', { name: '恢复默认', exact: true }).click()
  await until(async () => (await storage.get('keymap')).keymap?.['shortcuts:j'] === undefined)
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
