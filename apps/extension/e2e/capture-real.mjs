// 采集真实知乎页面的脱敏样本（开发工具，不进 CI，需要登录）。
// 用法：pnpm build && node e2e/capture-real.mjs
// 浏览器配置固定在项目下 .capture-profile：第一次运行会弹出窗口让你扫码登录知乎，
// 登录态保留，之后运行直接采集。所有采集通过扩展的命令面板完成，扩展不上传任何东西。
// 未登录时知乎只给简化版页面甚至风控错误页，采不到真实结构，所以必须登录。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const extDir = path.resolve(here, '../.output/chrome-mv3')
const OUT = path.resolve(here, '../../../captures')
const PROFILE = path.resolve(here, '../.capture-profile')

if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
  console.error('找不到构建好的扩展，请先运行 pnpm build')
  process.exit(1)
}
fs.mkdirSync(OUT, { recursive: true })

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: false,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--disable-gpu'],
})
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
const storage = {
  set: items => sw.evaluate(i => chrome.storage.local.set(i), items),
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitFor = (page, fn, timeout = 20_000) =>
  page.waitForFunction(fn, null, { timeout, polling: 200 }).catch(() => false)

// ---------- 登录 ----------

const loggedIn = async () => (await context.cookies('https://www.zhihu.com')).some(c => c.name === 'z_c0')

if (!(await loggedIn())) {
  const signin = await context.newPage()
  await signin.goto('https://www.zhihu.com/signin', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await signin.bringToFront()
  // 登录页出了什么提示，截屏下来看（每 15 秒一张，覆盖最新状态）
  const shotTimer = setInterval(() => {
    signin.screenshot({ path: path.resolve(OUT, 'signin.png') }).catch(() => {})
  }, 15_000)
  console.log('')
  console.log('⏳ 请在刚弹出的浏览器窗口里扫码登录知乎（最多等 10 分钟）……')
  const start = Date.now()
  while (!(await loggedIn())) {
    if (Date.now() - start > 600_000) {
      console.log('✗ 等登录超时。登录成功后重新运行这个脚本即可（登录态已保留）。')
      await context.close()
      process.exit(1)
    }
    if (signin.isClosed()) {
      console.log('✗ 浏览器窗口被关掉了。重新运行这个脚本再试。')
      await context.close()
      process.exit(1)
    }
    await sleep(2000)
  }
  clearInterval(shotTimer)
  console.log('✓ 登录成功')
  await sleep(3000)
  await signin.close().catch(() => {})
}

// ---------- 工具 ----------

/** 关掉知乎弹的登录框 / 弹窗（如果有） */
async function dismissLoginModal(page) {
  for (const selector of ['.Modal-closeButton', 'button[aria-label="关闭"]']) {
    const button = page.locator(selector).first()
    if ((await button.isVisible().catch(() => false)) === true) {
      await button.click({ timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(500)
      return
    }
  }
}

/** 打开页面，等够时间再回来（内容脚本初始化 + 知乎前端渲染） */
async function open(url, width = 1400) {
  const page = await context.newPage()
  await page.setViewportSize({ width, height: 900 })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(12_000)
  await dismissLoginModal(page)
  return page
}

/** 运行命令面板里的命令，返回面板里显示的文本。面板还没就绪时按 Ctrl+K 会被丢掉，重试 */
async function runCommand(page, title) {
  await page.bringToFront()
  const palette = page.locator('#zb-root .palette')
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {})
    await page.keyboard.press('Control+k')
    if (
      await palette.waitFor({ timeout: 4000 }).then(
        () => true,
        () => false,
      )
    )
      break
    if (attempt === 5) throw new Error('命令面板打不开（Ctrl+K 重试 6 次）')
    await sleep(2000)
  }
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
  const sheet = page.locator('#zb-root .sheet textarea')
  // 失败时提示只显示几秒，边等边把提示记下来
  let toast = ''
  const toastWatch = (async () => {
    while (true) {
      toast ||= (
        await page
          .locator('#zb-root .toast')
          .allTextContents()
          .catch(() => [])
      ).join('；')
      await sleep(500)
    }
  })()
  try {
    await sheet.waitFor({ timeout: 20_000 })
  } catch (error) {
    throw new Error(toast || String(error).split('\n')[0])
  } finally {
    toastWatch.catch(() => {})
  }
  const text = await sheet.inputValue()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  return text
}

const saved = []
let failed = 0
async function step(name, fn) {
  try {
    await fn()
    console.log(`✓ ${name}`)
    saved.push(name)
  } catch (error) {
    failed++
    console.log(`✗ ${name}\n  ${String(error?.message ?? error).split('\n')[0]}`)
  }
}

const writeSample = (name, text) => {
  const sample = JSON.parse(text)
  fs.writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(sample, null, 2)}\n`)
  if (!sample.expect?.contents)
    throw new Error(`样本里没有内容（expect=${JSON.stringify(sample.expect)}），页面可能没渲染出来`)
  return sample
}
const writeReport = (name, text) => {
  fs.writeFileSync(path.join(OUT, `diagnostic-${name}.txt`), text)
}
const capture = (page, name) => step(name, async () => writeSample(name, await runCommand(page, '采集页面样本')))
const diagnose = (page, name) =>
  step(`diagnostic-${name}`, async () => writeReport(name, await runCommand(page, '页面结构诊断')))

/** 展开评论区：找不到评论按钮、点开后没有评论出现都算失败，不装作成功 */
async function expandComments(page) {
  const button = page.locator('button', { hasText: /条评论|添加评论/ }).first()
  if ((await button.isVisible().catch(() => false)) !== true) throw new Error('没找到评论按钮')
  await button.click({ timeout: 3000 })
  if (
    !(await waitFor(
      page,
      () => document.querySelectorAll('.Comments [data-id], .CommentItemV2, .CommentItem').length > 0,
      10_000,
    ))
  )
    throw new Error('点开后没有出现评论')
}

/** 切到扩展的暗色主题；知乎自己的暗色要登录后在设置里改，采不到 */
const dark = on => storage.set({ 'settings:theme': on ? { colorScheme: 'dark' } : {} })
const waitTheme = (page, want) =>
  waitFor(
    page,
    want
      ? () => document.documentElement.getAttribute('data-theme') === 'dark'
      : () => !document.documentElement.hasAttribute('data-theme'),
    10_000,
  )

const linksOn = page =>
  page.evaluate(() => {
    const pick = pattern => {
      for (const a of document.querySelectorAll('a')) {
        const href = a.getAttribute('href') ?? ''
        if (pattern.test(href)) return href.split('?')[0]
      }
      return null
    }
    return {
      answer: pick(/(?:^|zhihu\.com)\/question\/\d+\/answer\/\d+/),
      question: pick(/(?:^|zhihu\.com)\/question\/\d+(?:\/|$)/),
      article: pick(/(?:^|zhihu\.com)\/p\/[a-z0-9]+/i),
      people: pick(/(?:^|zhihu\.com)\/people\/[^/?#]+/),
    }
  })

/** 用一个页面采一组样本，采完关掉 */
async function withPage(link, name, fn) {
  if (!link) {
    failed++
    console.log(`✗ ${name}：没有可用的页面链接`)
    return
  }
  const target = new URL(link, 'https://www.zhihu.com/').href
  let page
  try {
    page = await open(target)
    await fn(page)
  } catch (error) {
    failed++
    console.log(`✗ ${name}：${String(error?.message ?? error).split('\n')[0]}`)
  } finally {
    await page?.close().catch(() => {})
    await sleep(2000)
  }
}

// ---------- 1. 首页：链接来源 + 宽/窄 ----------

let links = {}
await withPage('https://www.zhihu.com/', 'home', async home => {
  await capture(home, 'home-wide-light')
  await diagnose(home, 'home-wide-light')
  links = await linksOn(home)
  console.log('首页链接：', links)

  await home.setViewportSize({ width: 800, height: 900 })
  await home.waitForTimeout(1500)
  await capture(home, 'home-narrow-light')
})

// ---------- 2. 问题页：宽/窄 + 评论区 ----------

let questionLinks = {}
await withPage(links.question, 'question', async question => {
  await step('question：展开评论区', () => expandComments(question))
  await capture(question, 'question-wide-light')
  await diagnose(question, 'question-wide-light')
  questionLinks = await linksOn(question)

  await question.setViewportSize({ width: 800, height: 900 })
  await question.waitForTimeout(1500)
  await capture(question, 'question-narrow-light')
})
if (!links.answer) links.answer = questionLinks.answer
if (!links.article) links.article = questionLinks.article
if (!links.people) links.people = questionLinks.people

// ---------- 3. 回答页（带评论区） ----------

await withPage(links.answer, 'answer', async answer => {
  await step('answer：展开评论区', () => expandComments(answer))
  await capture(answer, 'answer-wide-light')
  await diagnose(answer, 'answer-wide-light')
})

// ---------- 4. 专栏文章：宽/窄 + 评论区 ----------

await withPage(links.article, 'article', async article => {
  await step('article：展开评论区', () => expandComments(article))
  await capture(article, 'article-wide-light')
  await diagnose(article, 'article-wide-light')

  await article.setViewportSize({ width: 800, height: 900 })
  await article.waitForTimeout(1500)
  await capture(article, 'article-narrow-light')
})

// ---------- 5. 用户主页 / 搜索 / 热榜 ----------

await withPage(links.people, 'profile', async profile => {
  await capture(profile, 'profile-wide-light')
})

await withPage('https://www.zhihu.com/search?q=%E7%BC%96%E7%A8%8B&type=content', 'search', async search => {
  await capture(search, 'search-wide-light')
})

await withPage('https://www.zhihu.com/hot', 'hot', async hot => {
  await capture(hot, 'hot-wide-light')
  await diagnose(hot, 'hot-wide-light')
})

// ---------- 6. 暗色补一轮（浅色样本已经到手，暗色出问题也不影响它们） ----------

await withPage('https://www.zhihu.com/', 'home-dark', async home => {
  await step('home：切扩展暗色', async () => {
    await dark(true)
    if (!(await waitTheme(home, true))) throw new Error('暗色没生效')
  })
  await capture(home, 'home-wide-dark')
  await dark(false)
})

await withPage(links.question, 'question-dark', async question => {
  await step('question：切扩展暗色', async () => {
    await dark(true)
    if (!(await waitTheme(question, true))) throw new Error('暗色没生效')
  })
  await capture(question, 'question-wide-dark')
  await dark(false)
})

await context.close()
console.log(failed ? `\n${failed} 项失败` : '\n全部完成')
console.log(`已保存：${saved.join(', ')}`)
console.log(`输出在 ${OUT}`)
process.exit(failed ? 1 : 0)
