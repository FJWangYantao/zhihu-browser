// M0 探针：后台。汇总各环境发来的记录，保存在 chrome.storage.local 的 report 里；
// 负责注册两个用户脚本环境（A、B），测试 userScripts 相关能力。
// 本扩展不发起任何网络请求，所有数据只保存在本机。

const MATCHES = ['*://*.zhihu.com/*']

function emptyReport() {
  return {
    version: 1,
    createdAt: Date.now(),
    env: {},
    initialData: {},
    initialDataTiming: [],
    rewrite: [],
    prehide: [],
    api: {},
    filterLog: [],
    hookErrors: [],
    anchors: {},
    routes: { changes: 0, first: {}, detectedBy: {}, pollOnly: 0, samples: [] },
    bridge: {},
    userScripts: { setup: null, worlds: {}, execute: null },
    dark: [],
    pageLoads: {},
    manual: {},
  }
}

// 串行更新，避免并发读写互相覆盖
let chain = Promise.resolve()
function update(fn) {
  chain = chain
    .then(async () => {
      const { report = emptyReport() } = await chrome.storage.local.get('report')
      fn(report)
      report.updatedAt = Date.now()
      await chrome.storage.local.set({ report })
    })
    .catch(e => console.error('[M0 探针] 保存失败', e))
  return chain
}

function pushCapped(arr, item, cap) {
  arr.push(item)
  if (arr.length > cap) arr.splice(0, arr.length - cap)
}
function addUnique(arr, items) {
  for (const x of [].concat(items)) if (x != null && !arr.includes(x)) arr.push(x)
}
function trimKeys(obj, cap) {
  const keys = Object.keys(obj)
  for (const k of keys.slice(0, Math.max(0, keys.length - cap))) delete obj[k]
}

function mergeRecord(r, rec) {
  const d = rec.data || {}
  const pt = rec.pageType
  switch (rec.kind) {
    case 'env':
      r.env[d.world] = { ...d, at: Date.now() }
      break
    case 'initialData': {
      if (d.found) r.initialData[pt] = d
      const { shape, topLevelKeys, entityCounts, ...timing } = d
      pushCapped(r.initialDataTiming, { pageType: pt, ...timing }, 30)
      break
    }
    case 'rewriteResult':
      pushCapped(r.rewrite, { pageType: pt, ...d }, 30)
      break
    case 'prehide':
      pushCapped(r.prehide, { pageType: pt, ...d }, 30)
      break
    case 'api': {
      if (!r.api[d.key] && Object.keys(r.api).length >= 300) break
      const a = (r.api[d.key] ||= { count: 0, via: [], statuses: [], headers: [], pageTypes: [], enums: {} })
      a.count++
      addUnique(a.via, d.via)
      addUnique(a.statuses, d.status)
      addUnique(a.headers, d.headers)
      addUnique(a.pageTypes, pt)
      a.listLen = d.listLen
      a.pagingKeys = d.pagingKeys
      for (const [path, values] of Object.entries(d.enums || {})) {
        const target = (a.enums[path] ||= {})
        for (const [v, n] of Object.entries(values)) target[v] = (target[v] || 0) + n
      }
      if (d.shape) a.shape = d.shape
      break
    }
    case 'filter':
    case 'filterContinue':
      pushCapped(r.filterLog, { kind: rec.kind, pageType: pt, at: Date.now(), ...d }, 80)
      break
    case 'hookError':
      pushCapped(r.hookErrors, { pageType: pt, ...d }, 30)
      break
    case 'anchors': {
      const old = r.anchors[pt]
      if (!old || d.items >= old.items) r.anchors[pt] = { ...d, at: Date.now() }
      break
    }
    case 'route': {
      const rt = r.routes
      rt.changes++
      rt.first[d.first] = (rt.first[d.first] || 0) + 1
      for (const m of Object.keys(d.by || {})) rt.detectedBy[m] = (rt.detectedBy[m] || 0) + 1
      if (Object.keys(d.by || {}).length === 1 && d.first === 'poll') rt.pollOnly++
      const { t, ...sample } = d
      pushCapped(rt.samples, sample, 30)
      break
    }
    case 'bridge':
      r.bridge[d.from] = { ...d, at: Date.now() }
      break
    case 'bridgeObject':
      r.bridge['object-' + d.from] = d
      break
    case 'dark':
      pushCapped(r.dark, { ...d, at: Date.now() }, 10)
      break
    case 'status':
      r.pageLoads[rec.loadId] = { pageType: pt, ...d, at: Date.now() }
      trimKeys(r.pageLoads, 30)
      break
    case 'userWorld':
      r.userScripts.worlds[d.world] = { ...d, at: Date.now() }
      break
  }
}

// ---------- userScripts ----------

// 注入用户脚本环境的代码（会被转成字符串，不能引用外部变量）
function userWorldMain(name) {
  const stats = times => {
    if (!times.length) return { median: null, p95: null, max: null }
    const s = [...times].sort((a, b) => a - b)
    const r = x => Math.round(x * 1000) / 1000
    return { median: r(s[Math.floor(s.length / 2)]), p95: r(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]), max: r(s[s.length - 1]) }
  }
  const out = { world: name, loadedAtMs: Math.round(performance.now()) }
  globalThis['__zbp_' + name] = true
  out.seesPageGlobals = Object.keys(globalThis).some(k => k.startsWith('webpackChunk'))
  out.seesIsolatedGlobal = typeof globalThis.__zbpIsolated !== 'undefined'
  out.customElements = typeof customElements !== 'undefined' && customElements !== null
  out.hasRuntime = typeof chrome !== 'undefined' && !!chrome.runtime && typeof chrome.runtime.sendMessage === 'function'

  // 与 ISOLATED world 的同步 DOM 事件通信
  const N = 200
  const times = []
  let sync = 0
  let got = false
  const onPong = () => { got = true }
  document.addEventListener('zbp:pong-' + name, onPong)
  for (let i = 0; i < N; i++) {
    got = false
    const t = performance.now()
    document.dispatchEvent(new CustomEvent('zbp:ping', { detail: JSON.stringify({ from: name, i }) }))
    if (got) {
      sync++
      times.push(performance.now() - t)
    }
  }
  document.removeEventListener('zbp:pong-' + name, onPong)
  document.dispatchEvent(new CustomEvent('zbp:objtest-' + name, { detail: { from: name } }))
  out.domEvents = { n: N, sync, ...stats(times) }

  setTimeout(async () => {
    out.seesOtherWorldGlobal = typeof globalThis['__zbp_' + (name === 'A' ? 'B' : 'A')] !== 'undefined'
    if (out.hasRuntime) {
      const rt = []
      try {
        for (let i = 0; i < 20; i++) {
          const t = performance.now()
          await chrome.runtime.sendMessage({ type: 'us-ping' })
          rt.push(performance.now() - t)
        }
        out.runtimeMessaging = stats(rt)
        await chrome.runtime.sendMessage({ type: 'us-report', data: out })
        return
      } catch (e) {
        out.runtimeMessagingError = String((e && e.message) || e)
      }
    }
    // 没有扩展消息通道时，通过 ISOLATED world 转交
    const rec = { kind: 'userWorld', loadId: 'user-' + name, pageType: null, t: 0, data: out }
    document.dispatchEvent(new CustomEvent('zbp:record', { detail: JSON.stringify(rec) }))
  }, 1000)
}

const errText = e => String((e && e.message) || e)

async function setupUserScripts() {
  const s = { at: Date.now(), available: false, steps: {} }
  let api
  try {
    api = chrome.userScripts
    if (!api) throw new Error('chrome.userScripts 不存在')
    await api.getScripts()
    s.available = true
  } catch (e) {
    s.error = errText(e)
    await update(r => { r.userScripts.setup = s })
    return s
  }

  try {
    await api.configureWorld({ worldId: 'zbp-a', messaging: true })
    await api.configureWorld({ worldId: 'zbp-b', messaging: true })
    s.steps.configureWorldWithId = 'ok'
  } catch (e) {
    s.steps.configureWorldWithId = errText(e)
    try {
      await api.configureWorld({ messaging: true })
      s.steps.configureWorldDefault = 'ok'
    } catch (e2) {
      s.steps.configureWorldDefault = errText(e2)
    }
  }

  try {
    await api.unregister()
  } catch {}
  const script = (name, worldId) => ({
    id: 'zbp-' + name,
    matches: MATCHES,
    js: [{ code: `(${userWorldMain.toString()})(${JSON.stringify(name)})` }],
    runAt: 'document_idle',
    world: 'USER_SCRIPT',
    ...(worldId ? { worldId } : {}),
  })
  try {
    await api.register([script('A', 'zbp-a'), script('B', 'zbp-b')])
    s.steps.registerWithWorldId = 'ok'
  } catch (e) {
    s.steps.registerWithWorldId = errText(e)
    try {
      await api.register([script('A'), script('B')])
      s.steps.registerDefaultWorld = 'ok'
    } catch (e2) {
      s.steps.registerDefaultWorld = errText(e2)
    }
  }
  try {
    s.registered = (await api.getScripts()).map(x => x.id)
  } catch {}
  s.hasOnUserScriptMessage = !!chrome.runtime.onUserScriptMessage
  s.hasExecute = typeof api.execute === 'function'
  await update(r => { r.userScripts.setup = s })
  return s
}

// 向已打开页面的用户脚本环境 A 执行代码：如果能读到 A 里注册脚本设置的变量，
// 说明可以在不刷新页面的情况下往同一个环境里加载新代码（热重载的前提）
async function testExecute(tabId) {
  let res
  try {
    const api = chrome.userScripts
    if (typeof api?.execute !== 'function') throw new Error('userScripts.execute 不可用')
    const r = await api.execute({
      target: { tabId },
      js: [{ code: 'typeof globalThis.__zbp_A !== "undefined"' }],
      world: 'USER_SCRIPT',
      worldId: 'zbp-a',
    })
    res = { ok: true, sameWorldAsRegisteredA: r?.[0]?.result === true }
  } catch (e) {
    res = { ok: false, error: errText(e) }
  }
  await update(r => { r.userScripts.execute = { ...res, at: Date.now() } })
}

// ---------- 消息 ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'records':
      update(r => msg.recs.forEach(rec => mergeRecord(r, rec)))
      break
    case 'page-hello':
      if (sender.tab?.id != null) testExecute(sender.tab.id)
      break
    case 'recheck-userscripts':
      setupUserScripts().then(sendResponse)
      return true
    case 'save-manual':
      update(r => { r.manual = msg.manual }).then(() => sendResponse(true))
      return true
    case 'clear-report':
      chain = chain.then(() => chrome.storage.local.set({ report: emptyReport() }))
      chain.then(() => sendResponse(true))
      return true
  }
})

if (chrome.runtime.onUserScriptMessage) {
  chrome.runtime.onUserScriptMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'us-ping') {
      sendResponse({ ok: true })
    } else if (msg?.type === 'us-report') {
      update(r => mergeRecord(r, { kind: 'userWorld', data: msg.data })).then(() => sendResponse(true))
      return true
    }
  })
}

chrome.runtime.onInstalled.addListener(() => setupUserScripts())
chrome.runtime.onStartup.addListener(() => setupUserScripts())
