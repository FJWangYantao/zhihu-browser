// M0 探针冒烟测试：在本地模拟的知乎页面上加载扩展，检查各项探测都能产生记录。
// 用法：cd spike/m0-probe/dev && npm install && npm run smoke
// 不访问真实的知乎：用 --host-resolver-rules 把 *.zhihu.com 指向本地服务器。
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const extDir = path.resolve(here, '../extension')
const site = path.join(here, 'mock-site')
const PORT = 18080

// ---------- 模拟知乎 ----------
function list(ids, isEnd = false) {
  return { data: ids.map(id => ({ type: 'feed', verb: 'TOPIC_ACKNOWLEDGED_ANSWER', target: { type: 'answer', id } })), paging: { is_end: isEnd, next: 'x' } }
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://www.zhihu.com')
  const json = body => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  if (u.pathname === '/api/v3/feed/topstory/recommend') {
    const p = Number(u.searchParams.get('page_number'))
    return json(list([p * 100 + 1, p * 100 + 2, p * 100 + 3, p * 100 + 4], p >= 5))
  }
  if (u.pathname === '/api/v4/questions/1/feeds') return json(list([901, 902, 903, 904, 905]))
  if (u.pathname === '/api/v4/editor/link_card_infos') {
    return json({ link_card_info: { 'https://www.zhihu.com/answer/776655': { title: 't' }, 'https://zhuanlan.zhihu.com/p/887766': { title: 't' } } })
  }
  if (u.pathname.startsWith('/api/')) return json({ data: [], paging: { is_end: true } })
  if (u.pathname === '/static/app.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    return res.end(fs.readFileSync(path.join(site, 'app.js')))
  }
  if (u.pathname === '/favicon.ico') {
    res.writeHead(404)
    return res.end()
  }
  // 严格的 CSP：不允许内联脚本和内联样式，检验探针在 CSP 下仍然工作
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; style-src 'self'" })
  res.end(fs.readFileSync(path.join(site, 'page.html')))
})
await new Promise(r => server.listen(PORT, '127.0.0.1', r))

// ---------- 启动带扩展的 Chromium ----------
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm0-probe-'))
const context = await chromium.launchPersistentContext(userDir, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    `--host-resolver-rules=MAP *.zhihu.com 127.0.0.1:${PORT}`,
  ],
})
let sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
const extId = new URL(sw.url()).host
const report = async () => (await sw.evaluate(() => chrome.storage.local.get('report'))).report
const setConfig = config => sw.evaluate(c => chrome.storage.local.set({ config: c }), config)
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 尝试在扩展详情页打开"允许用户脚本"（Chrome 138+）
let userScriptsToggled = false
try {
  const p = await context.newPage()
  await p.goto(`chrome://extensions/?id=${extId}`)
  const toggle = p.locator('#allow-user-scripts, #allowUserScripts, [id*="user-scripts" i], [id*="userscripts" i]').first()
  await toggle.click({ timeout: 5000 })
  userScriptsToggled = true
  await p.close()
} catch (e) {
  console.log('未能自动打开"允许用户脚本"：', e.message.split('\n')[0])
}
await sw.evaluate(() => chrome.runtime.onMessage.hasListeners()) // 确认后台已就绪
const setup = await sw.evaluate(async () => {
  // 直接调用后台里的函数，相当于在弹窗里点"重新检测"
  return await self.setupUserScripts()
}).catch(e => ({ error: e.message }))

// ---------- 第一轮：不开实验 ----------
await setConfig({ filterMode: 'off', initialDataMode: 'off', prehide: false })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message))
await page.goto('http://www.zhihu.com/')
await page.reload() // 第一次加载时 isolated.js 才把配置写进 localStorage
await sleep(6000)
await page.evaluate(() => window.scrollBy(0, 200))
await sleep(3000)
const app1 = await page.evaluate(() => window.__app)
// 用户主页：检验用户标识不会进入报告
await page.goto('http://www.zhihu.com/people/ab-cd-12')
await sleep(9500)
await page.close()

// ---------- 第二轮：打开全部实验 ----------
await setConfig({ filterMode: 'drop-all', initialDataMode: 'drop-answer', prehide: true })
const page2 = await context.newPage()
page2.on('pageerror', e => pageErrors.push(e.message))
await page2.goto('http://www.zhihu.com/')
await page2.reload()
await sleep(9500) // 等到页面第一次上报状态（加载后 8 秒）
const app2 = await page2.evaluate(() => ({ ...window.__app, ssrItems: document.querySelectorAll('[data-zop*="111"]').length }))
await page2.evaluate(() => {
  const s = document.createElement('div')
  s.id = 'sentinel'
  document.body.append(s)
})
await page2.close()
await sleep(2500)

// 报告页和弹窗能正常渲染
const uiErrors = []
const reportPage = await context.newPage()
reportPage.on('pageerror', e => uiErrors.push('report: ' + e.message))
await reportPage.goto(`chrome-extension://${extId}/report.html`)
await sleep(1000)
const reportUi = await reportPage.evaluate(() => ({
  sections: document.querySelectorAll('section').length,
  broken: document.body.innerText.includes('渲染出错'),
}))
const popupPage = await context.newPage()
popupPage.on('pageerror', e => uiErrors.push('popup: ' + e.message))
await popupPage.goto(`chrome-extension://${extId}/popup.html`)
await sleep(500)

const r = await report()
await context.close()
server.close()

// ---------- 检查 ----------
const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail })
check('页面主环境脚本运行', r.env.MAIN)
check('扩展隔离环境脚本运行', r.env.ISOLATED)
check('读到首屏数据', r.initialData.home?.found, JSON.stringify(r.initialData.home?.entityCounts))
check('报告里没有任何用户标识', ['zhang-san', 'li-si', 'ab-cd-12', 'purelettertoken'].every(t => !JSON.stringify(r).includes(t)),
  ['zhang-san', 'li-si', 'ab-cd-12', 'purelettertoken'].filter(t => JSON.stringify(r).includes(t)).join(', '))
check('以网址为键的映射被折叠，内容 id 不进报告', !JSON.stringify(r).includes('776655') && !JSON.stringify(r).includes('887766'))
check('接口地址里的用户标识被替换、固定词保留', ['moments/:token/activities', 'profile/:token/infinity', 'moments/extra', 'somewhere/:token'].every(k => Object.keys(r.api).some(a => a.includes(k))), Object.keys(r.api).join(' | '))
check('读到首屏数据时前端未启动', r.initialDataTiming.some(t => t.appBootedBeforeSeen === false))
check('拦截到 fetch 接口', Object.keys(r.api).some(k => k.includes('recommend')), Object.keys(r.api).join(' | '))
check('拦截到 XHR 接口', Object.values(r.api).some(a => a.via.includes('xhr')))
check('记录了签名请求头名', Object.values(r.api).some(a => a.headers.includes('x-zse-96')))
check('记录了类型枚举', Object.values(r.api).some(a => a.enums['data[].target.type']?.answer))
check('接口地址中的 id 已替换', Object.keys(r.api).every(k => !/\/\d+/.test(k)), Object.keys(r.api).join(' | '))
check('拦截覆盖率', Object.values(r.pageLoads).some(l => l.coverage.perf > 0 && l.coverage.missed.length === 0), JSON.stringify(Object.values(r.pageLoads).map(l => l.coverage)))
check('第一轮页面正常拿到数据', app1.fetchItems > 0 && app1.xhrItems === 5, JSON.stringify(app1))
check('过滤实验：条目被全部去掉', app2.fetchItems === 0 && app2.xhrItems === 0, JSON.stringify(app2))
check('过滤实验：记录了自动加载下一页', r.filterLog.some(f => f.kind === 'filterContinue'))
check('首屏改写：被删掉的回答不再显示', r.rewrite.some(x => x.removedAnswerStillRendered === false), JSON.stringify(r.rewrite))
check('预隐藏：严格 CSP 下隐藏样式生效，处理后显示，没有超时', r.prehide.some(x => x.processed > 0 && x.hiddenBeforeMark > 0 && !x.timeoutFired), JSON.stringify(r.prehide))
check('锚点：内容元素都找到了 id', Object.values(r.anchors).some(a => a.items > 0 && a.anyId === a.items), JSON.stringify(Object.values(r.anchors).map(a => ({ items: a.items, idBy: a.idBy, inStore: a.inStore }))))
check('锚点：id 能在数据中找到', Object.values(r.anchors).some(a => a.inStore > 0))
check('路由：检测到页面切换', r.routes.changes >= 3 && r.routes.pollOnly === 0, JSON.stringify(r.routes.first))
check('MAIN ↔ ISOLATED 同步通信', r.bridge.MAIN?.sync === r.bridge.MAIN?.n, JSON.stringify(r.bridge.MAIN))
check('页面没有报错', pageErrors.length === 0, pageErrors.join(' | '))
check('两轮实验的页面状态都记录到了', Object.values(r.pageLoads).some(l => l.config.filterMode === 'drop-all') && Object.values(r.pageLoads).some(l => l.config.filterMode === 'off'), JSON.stringify(Object.values(r.pageLoads).map(l => l.config.filterMode)))
check('报告页 9 个部分都渲染出来', reportUi.sections === 9 && !reportUi.broken, JSON.stringify(reportUi))
check('报告页和弹窗没有脚本错误', uiErrors.length === 0, uiErrors.join(' | '))

console.log('\n用户脚本：', userScriptsToggled ? '已自动打开开关' : '开关未打开', JSON.stringify(setup))
if (setup?.available) {
  check('用户脚本环境 A 有结果', r.userScripts.worlds.A, JSON.stringify(r.userScripts.worlds.A))
  check('用户脚本环境相互隔离', r.userScripts.worlds.A?.seesOtherWorldGlobal === false)
  check('userScripts.execute 进入已有环境', r.userScripts.execute?.sameWorldAsRegisteredA, JSON.stringify(r.userScripts.execute))
}
for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : '  ' + c.detail}`)
fs.writeFileSync(path.join(here, 'last-report.json'), JSON.stringify(r, null, 2))
console.log('\n完整报告已写入 dev/last-report.json')
process.exit(checks.every(c => c.ok) ? 0 : 1)
