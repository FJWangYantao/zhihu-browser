// M0 探针：页面主环境（MAIN world）部分，和知乎页面脚本共享 JS 环境。
// 只记录结构信息（字段名、类型、数量、少量枚举值），不记录正文、用户名、id 或 Cookie。
// 记录通过 DOM 事件交给 isolated.js，再由后台保存到本地。
(() => {
  'use strict'

  const T0 = performance.now()
  const LANDING = location.href
  const LOAD_ID = Math.random().toString(36).slice(2, 10)
  const hasWebpack = () => Object.keys(window).some(k => k.startsWith('webpackChunk'))

  // ---------- 配置：isolated.js 把扩展里的配置同步到 localStorage，这里同步读取 ----------
  const config = { filterMode: 'off', initialDataMode: 'off', prehide: false }
  try {
    Object.assign(config, JSON.parse(localStorage.getItem('zbp-config') || '{}'))
  } catch {}

  // ---------- 页面类型与地址规范化 ----------
  function pageType(href) {
    const u = new URL(href, location.href)
    const p = u.pathname
    if (u.hostname === 'zhuanlan.zhihu.com') return /^\/p\/\d+/.test(p) ? 'article' : 'other'
    if (p === '/') return 'home'
    if (/^\/follow\b/.test(p)) return 'follow'
    if (/^\/hot\b/.test(p)) return 'hot'
    if (/^\/question\/\d+\/answer\/\d+/.test(p)) return 'answer'
    if (/^\/question\/\d+/.test(p)) return 'question'
    if (/^\/search\b/.test(p)) return 'search'
    if (/^\/(people|org)\//.test(p)) return 'people'
    if (/^\/collection\//.test(p)) return 'collection'
    if (/^\/pin\//.test(p)) return 'pin'
    if (/^\/topic\//.test(p)) return 'topic'
    if (/^\/zvideo\//.test(p)) return 'video'
    return 'other'
  }

  // 把地址里的 id、用户标识替换掉，只保留查询参数名
  function normalizePath(u) {
    const segs = u.pathname.split('/').map((s, i, arr) => {
      if (!s) return s
      if (/^\d+$/.test(s) || /^[0-9a-f]{16,}$/i.test(s)) return ':id'
      if (i > 0 && /^(people|org|members)$/.test(arr[i - 1])) return ':token'
      if (s.length > 40) return ':long'
      return s
    })
    return u.host + segs.join('/')
  }
  function normalizeUrl(u) {
    const keys = [...new Set(u.searchParams.keys())].sort()
    return normalizePath(u) + (keys.length ? '?' + keys.join('&') : '')
  }
  function apiUrl(raw) {
    try {
      const u = new URL(raw, location.href)
      if (!/(^|\.)zhihu\.com$/.test(u.hostname)) return null
      if (u.hostname === 'api.zhihu.com' || u.pathname.startsWith('/api/')) return u
    } catch {}
    return null
  }

  // ---------- 发送记录 ----------
  const queue = []
  let bridgeReady = false
  function emit(rec) {
    document.dispatchEvent(new CustomEvent('zbp:record', { detail: JSON.stringify(rec) }))
  }
  function send(kind, data) {
    const rec = { kind, loadId: LOAD_ID, pageType: pageType(location.href), t: Math.round(performance.now() - T0), data }
    if (bridgeReady) emit(rec)
    else queue.push(rec)
  }
  document.addEventListener('zbp:isolated-ready', () => {
    if (bridgeReady) return
    bridgeReady = true
    queue.splice(0).forEach(emit)
    runBridgeTest()
  })
  document.dispatchEvent(new CustomEvent('zbp:main-ready'))

  function stats(times) {
    if (!times.length) return { median: null, p95: null, max: null }
    const s = [...times].sort((a, b) => a - b)
    const r = x => Math.round(x * 1000) / 1000
    return { median: r(s[Math.floor(s.length / 2)]), p95: r(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]), max: r(s[s.length - 1]) }
  }

  // ---------- 结构摘要：只保留字段名和类型 ----------
  const idLike = k => /^\d+$/.test(k) || /^[0-9a-f]{16,}$/i.test(k) || k.includes('-') || /^[A-Za-z0-9_]{24,}$/.test(k)

  function merge(a, b) {
    if (a === undefined) return b
    if (b === undefined) return a
    if (typeof a === 'string' && typeof b === 'string') {
      return a === b ? a : [...new Set([...a.split('|'), ...b.split('|')])].sort().join('|')
    }
    if (typeof a === 'object' && typeof b === 'object') {
      const out = { ...a }
      for (const k of Object.keys(b)) {
        if (!(k in out)) out[k] = b[k]
        else if (k === '#len' || k === '#count') out[k] = Math.max(out[k], b[k])
        else out[k] = merge(out[k], b[k])
      }
      return out
    }
    return typeof a === 'object' ? a : b
  }

  function shape(v, key = '', parentKey = '', depth = 0, maxDepth = 6) {
    if (v === null) return 'null'
    if (Array.isArray(v)) {
      const el = v.slice(0, 3).map(x => shape(x, key, parentKey, depth + 1, maxDepth)).reduce(merge, undefined)
      return { '#array': el === undefined ? 'empty' : el, '#len': v.length }
    }
    if (typeof v !== 'object') return typeof v
    if (depth >= maxDepth) return 'object'
    const keys = Object.keys(v)
    const isIdMap =
      keys.length > 0 &&
      (parentKey === 'entities' ||
        (keys.length >= 2 && keys.filter(idLike).length / keys.length >= 0.5))
    if (isIdMap) {
      const el = keys.slice(0, 3).map(k => shape(v[k], '#id', key, depth + 1, maxDepth)).reduce(merge, undefined)
      return { '#idMap': el, '#count': keys.length }
    }
    const out = {}
    for (const k of keys.slice(0, 60)) out[k] = shape(v[k], k, key, depth + 1, maxDepth)
    if (keys.length > 60) out['#more'] = keys.length - 60
    return out
  }

  // 枚举值：只收集 type / verb / kind 这几个字段里像枚举的短字符串
  const ENUM_KEYS = new Set(['type', 'verb', 'kind'])
  function enums(v, path, out, depth = 0) {
    if (!v || typeof v !== 'object' || depth > 6) return out
    if (Array.isArray(v)) {
      v.slice(0, 20).forEach(x => enums(x, path + '[]', out, depth + 1))
      return out
    }
    for (const [k, x] of Object.entries(v)) {
      const p = path ? path + '.' + k : k
      if (ENUM_KEYS.has(k) && typeof x === 'string' && x.length <= 40 && /^[\w.-]+$/.test(x)) {
        out[p] ??= {}
        out[p][x] = (out[p][x] || 0) + 1
      } else if (x && typeof x === 'object') enums(x, p, out, depth + 1)
    }
    return out
  }

  // 数据里出现过的内容 id，只在内存里用于检查"元素能否对应到数据"，不会被记录
  const idStore = new Set()
  function collectIds(v, key = '', parentKey = '', depth = 0) {
    if (depth > 12 || idStore.size > 20000 || !v || typeof v !== 'object') return
    if (Array.isArray(v)) {
      v.forEach(x => collectIds(x, key, parentKey, depth + 1))
      return
    }
    if (parentKey === 'entities') Object.keys(v).forEach(k => idStore.add(k))
    for (const [k, x] of Object.entries(v)) {
      if ((k === 'id' || k === 'itemId') && (typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)))) {
        idStore.add(String(x))
      } else if (x && typeof x === 'object') collectIds(x, k, key, depth + 1)
    }
  }

  // ---------- 页面错误计数（用来判断实验是否弄坏了页面） ----------
  let errors = 0
  let rejections = 0
  const errorSamples = []
  window.addEventListener('error', e => {
    if (!(e instanceof ErrorEvent)) return
    errors++
    if (errorSamples.length < 5) errorSamples.push(String(e.message).slice(0, 120))
  }, true)
  window.addEventListener('unhandledrejection', () => rejections++)

  // ---------- 1. 首屏数据 js-initialData ----------
  const initial = { attempts: 0, done: false }
  let removedAnswerId = null

  function tryInitialData(el) {
    initial.attempts++
    const text = el.textContent
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return // 可能还没解析完，等下一次变化
    }
    initial.done = true
    const scriptsBefore = [...document.querySelectorAll('script[src]')].filter(
      s => s.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).length
    const entities = json?.initialState?.entities
    const info = {
      found: true,
      bytes: text.length,
      parseAttempts: initial.attempts,
      readyState: document.readyState,
      msSinceStart: Math.round(performance.now() - T0),
      appBootedBeforeSeen: hasWebpack(),
      externalScriptsBefore: scriptsBefore,
      topLevelKeys: Object.keys(json),
      entityCounts: entities && typeof entities === 'object'
        ? Object.fromEntries(Object.entries(entities).map(([k, x]) => [k, x && typeof x === 'object' ? Object.keys(x).length : 0]))
        : null,
      shape: shape(json, '', '', 0, 5),
    }
    collectIds(json)

    if (config.initialDataMode === 'roundtrip') {
      el.textContent = JSON.stringify(json)
      info.rewrite = 'roundtrip'
    } else if (config.initialDataMode === 'drop-answer') {
      const answers = entities?.answers
      const ids = answers && typeof answers === 'object' ? Object.keys(answers) : []
      if (ids.length) {
        removedAnswerId = ids[0]
        delete answers[ids[0]]
        el.textContent = JSON.stringify(json)
        info.rewrite = 'drop-answer'
      } else {
        info.rewrite = 'drop-answer（没有找到 initialState.entities.answers）'
      }
    }
    if (info.rewrite) info.rewriteBeforeAppBoot = !hasWebpack()
    send('initialData', info)
  }

  const initialObserver = new MutationObserver(() => {
    if (initial.done) return initialObserver.disconnect()
    const el = document.getElementById('js-initialData')
    if (el) tryInitialData(el)
  })
  initialObserver.observe(document, { childList: true, subtree: true, characterData: true })

  document.addEventListener('DOMContentLoaded', () => {
    initialObserver.disconnect()
    if (!initial.done) {
      const el = document.getElementById('js-initialData')
      if (el) tryInitialData(el)
      if (!initial.done) send('initialData', { found: !!el, parseAttempts: initial.attempts, readyState: document.readyState })
    }
    if (removedAnswerId) {
      setTimeout(() => {
        const id = removedAnswerId
        const still = !!document.querySelector(
          `[data-zop*="${id}"], a[href*="/answer/${id}"], meta[itemprop="url"][content*="/answer/${id}"]`,
        )
        send('rewriteResult', { mode: 'drop-answer', removedAnswerStillRendered: still, errors, rejections })
      }, 4000)
    }
  })

  // ---------- 3. 首屏预隐藏实验 ----------
  if (config.prehide) setupPrehide()

  function setupPrehide() {
    // 隐藏样式由扩展注入（prehide.css），不受知乎 CSP 影响；这里只负责打开开关和标记已处理的元素
    const SEL = '.ContentItem, .TopstoryItem, .List-item'
    const st = { processed: 0, hiddenBeforeMark: 0, batches: 0, maxBatchMs: 0, firstMarkMs: null, timeoutFired: false }
    const root = () => document.documentElement
    const enable = () => root().setAttribute('data-zbp-prehide', '')
    if (root()) enable()
    else new MutationObserver((_, o) => { if (root()) { o.disconnect(); enable() } }).observe(document, { childList: true })

    const mark = () => {
      const t = performance.now()
      const els = document.querySelectorAll(`:is(${SEL}):not([data-zbp-ok])`)
      if (!els.length) return
      // 抽查第一个元素：标记前确实处于隐藏状态，说明样式生效了
      if (getComputedStyle(els[0]).visibility === 'hidden') st.hiddenBeforeMark++
      els.forEach(el => el.setAttribute('data-zbp-ok', ''))
      st.processed += els.length
      st.batches++
      st.maxBatchMs = Math.max(st.maxBatchMs, Math.round((performance.now() - t) * 1000) / 1000)
      st.firstMarkMs ??= Math.round(performance.now() - T0)
    }
    new MutationObserver(mark).observe(document, { childList: true, subtree: true })

    document.addEventListener('DOMContentLoaded', () => {
      // 超时放行：如果处理完全没有发生，就关掉隐藏，保证页面可用
      setTimeout(() => {
        if (st.processed === 0 && document.querySelector(SEL)) {
          st.timeoutFired = true
          root().removeAttribute('data-zbp-prehide')
        }
      }, 1500)
      setTimeout(() => send('prehide', { ...st, errors, rejections }), 3000)
    })
  }

  // ---------- 2. 接口拦截与改写 ----------
  const LIST_PATH = /feed|recommend|moments|answers|search|comment|hot/i
  const lastDropAll = new Map()
  const apiSeen = new Map()
  const hookedKeys = new Set()
  const perfKeys = new Set()
  let hookedCount = 0
  let perfCount = 0

  function maybeFilter(u, json) {
    if (config.filterMode === 'off' || !json || !Array.isArray(json.data) || !json.paging) return null
    if (!LIST_PATH.test(u.pathname)) return null
    const endpoint = normalizePath(u)
    const before = json.data.length
    const data = config.filterMode === 'drop-all' ? [] : json.data.filter((_, i) => i % 2 === 0)
    send('filter', { endpoint, mode: config.filterMode, before, after: data.length, isEnd: json.paging.is_end ?? null })
    if (config.filterMode === 'drop-all') lastDropAll.set(endpoint, performance.now())
    return { ...json, data }
  }

  function noteRequest(u) {
    hookedCount++
    hookedKeys.add(normalizePath(u))
  }

  function recordApi(u, method, via, headers, json, status) {
    const endpoint = normalizePath(u)
    const key = `${method} ${normalizeUrl(u)}`
    const n = (apiSeen.get(key) || 0) + 1
    apiSeen.set(key, n)
    collectIds(json)
    const dropAt = lastDropAll.get(endpoint)
    if (dropAt !== undefined) {
      lastDropAll.delete(endpoint)
      const afterMs = Math.round(performance.now() - dropAt)
      if (afterMs < 15000) send('filterContinue', { endpoint, afterMs })
    }
    send('api', {
      key,
      via,
      status,
      headers: headers.filter(h => /^x-/i.test(h)),
      listLen: Array.isArray(json?.data) ? json.data.length : null,
      pagingKeys: json?.paging && typeof json.paging === 'object' ? Object.keys(json.paging) : null,
      enums: enums(json, '', {}),
      shape: n <= 2 ? shape(json) : undefined,
    })
  }

  function headerNames(h) {
    if (!h) return []
    try {
      if (h instanceof Headers) return [...h.keys()]
      if (Array.isArray(h)) return h.map(x => String(x[0]).toLowerCase())
      return Object.keys(h).map(k => k.toLowerCase())
    } catch {
      return []
    }
  }

  const origFetch = window.fetch
  window.fetch = async function (input, init) {
    const raw = input instanceof Request ? input.url : String(input)
    const u = apiUrl(raw)
    if (!u) return origFetch.apply(window, arguments)
    noteRequest(u)
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const headers = [...new Set([...headerNames(input instanceof Request ? input.headers : null), ...headerNames(init?.headers)])]
    const res = await origFetch.apply(window, arguments)
    try {
      if (!(res.headers.get('content-type') || '').includes('json')) return res
      const json = JSON.parse(await res.clone().text())
      recordApi(u, method, 'fetch', headers, json, res.status)
      const modified = maybeFilter(u, json)
      if (modified) {
        const out = new Response(JSON.stringify(modified), { status: res.status, statusText: res.statusText, headers: res.headers })
        Object.defineProperty(out, 'url', { value: res.url })
        return out
      }
    } catch (e) {
      send('hookError', { via: 'fetch', message: String(e?.message || e).slice(0, 120) })
    }
    return res
  }

  const XHR = XMLHttpRequest.prototype
  const origOpen = XHR.open
  const origSetHeader = XHR.setRequestHeader
  XHR.open = function (method, url) {
    const u = apiUrl(String(url))
    if (u) {
      this.__zbp = { method: String(method).toUpperCase(), u, headers: [] }
      noteRequest(u)
      // 在 open 里注册，早于知乎（axios）在 open 之后设置的回调，所以能先改写响应
      this.addEventListener('readystatechange', onXhrState)
    }
    return origOpen.apply(this, arguments)
  }
  XHR.setRequestHeader = function (name) {
    if (this.__zbp) this.__zbp.headers.push(String(name).toLowerCase())
    return origSetHeader.apply(this, arguments)
  }
  function onXhrState() {
    if (this.readyState !== 4 || !this.__zbp) return
    const { method, u, headers } = this.__zbp
    try {
      const type = this.responseType
      let json
      if (type === '' || type === 'text') {
        if (!(this.getResponseHeader('content-type') || '').includes('json')) return
        json = JSON.parse(this.responseText)
      } else if (type === 'json') {
        json = this.response
      } else return
      recordApi(u, method, 'xhr', headers, json, this.status)
      const modified = maybeFilter(u, json)
      if (modified) {
        const text = JSON.stringify(modified)
        Object.defineProperty(this, 'responseText', { configurable: true, get: () => text })
        Object.defineProperty(this, 'response', { configurable: true, get: () => (type === 'json' ? modified : text) })
      }
    } catch (e) {
      send('hookError', { via: 'xhr', message: String(e?.message || e).slice(0, 120) })
    }
  }

  // 用浏览器的资源计时核对：页面发出的接口请求是不是都被我们拦到了
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.initiatorType !== 'fetch' && e.initiatorType !== 'xmlhttprequest') continue
        const u = apiUrl(e.name)
        if (!u) continue
        perfCount++
        perfKeys.add(normalizePath(u))
      }
    }).observe({ type: 'resource', buffered: true })
  } catch {}

  function sendStatus() {
    send('status', {
      landingPageType: pageType(LANDING),
      config,
      errors,
      rejections,
      errorSamples,
      coverage: {
        hooked: hookedCount,
        perf: perfCount,
        missed: [...perfKeys].filter(k => !hookedKeys.has(k)).slice(0, 10),
        fetchStillPatched: window.fetch.toString().includes('noteRequest'),
      },
    })
  }
  setTimeout(sendStatus, 8000)
  setInterval(sendStatus, 15000)
  addEventListener('pagehide', sendStatus)

  // ---------- 5. 单页应用路由变化 ----------
  let lastUrl = location.href
  let change = null
  function flushChange(c) {
    if (change !== c) return
    send('route', change)
    change = null
  }
  function signal(mech) {
    const url = location.href
    if (url !== lastUrl) {
      if (change) flushChange(change)
      const c = { from: pageType(lastUrl), to: pageType(url), first: mech, by: { [mech]: 0 }, t: performance.now() }
      change = c
      lastUrl = url
      setTimeout(() => flushChange(c), 1500)
      scheduleAnchors(2500)
    } else if (change && !(mech in change.by)) {
      change.by[mech] = Math.round(performance.now() - change.t)
    }
  }
  for (const name of ['pushState', 'replaceState']) {
    const orig = history[name]
    history[name] = function () {
      const r = orig.apply(this, arguments)
      signal(name)
      return r
    }
  }
  addEventListener('popstate', () => signal('popstate'))
  if (window.navigation) navigation.addEventListener('currententrychange', () => signal('navigation'))
  setInterval(() => signal('poll'), 250)

  // ---------- 4. 锚点：能不能从内容元素找到对应的数据 ----------
  const SELECTORS = {
    ContentItem: '.ContentItem',
    AnswerItem: '.AnswerItem',
    ArticleItem: '.ArticleItem',
    TopstoryItem: '.TopstoryItem',
    'List-item': '.List-item',
    Card: '.Card',
    QuestionHeader: '.QuestionHeader',
    RichContent: '.RichContent',
    'ContentItem-actions': '.ContentItem-actions',
    CommentItem: '[class*="CommentItem"]',
    'data-zop': '[data-zop]',
    itemprop: '[itemprop]',
    'data-za-detail-view-path-module': '[data-za-detail-view-path-module]',
    'data-za-extra-module': '[data-za-extra-module]',
  }
  const ID_RE = /\/(?:answer|p|pin|zvideo)\/(\d+)/

  function reactIds(el) {
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
    if (!fiberKey) return { hasFiber: false }
    const out = { hasFiber: true, propKeys: new Set(), ids: new Set() }
    let f = el[fiberKey]
    for (let i = 0; f && i < 25; i++, f = f.return) {
      const p = f.memoizedProps
      if (!p || typeof p !== 'object') continue
      try {
        for (const k of Object.keys(p)) {
          const x = p[k]
          if (x && typeof x === 'object' && !Array.isArray(x) && (typeof x.id === 'number' || typeof x.id === 'string')) {
            out.propKeys.add(k)
            out.ids.add(String(x.id))
          }
        }
      } catch {}
    }
    return out
  }

  function probeAnchors() {
    const counts = {}
    for (const [name, sel] of Object.entries(SELECTORS)) counts[name] = document.querySelectorAll(sel).length

    const itemprop = {}
    document.querySelectorAll('[itemprop]').forEach(el => {
      const n = el.getAttribute('itemprop')
      itemprop[n] = (itemprop[n] || 0) + 1
    })
    const zopKeys = new Set()
    document.querySelectorAll('[data-zop]').forEach(el => {
      try { Object.keys(JSON.parse(el.getAttribute('data-zop'))).forEach(k => zopKeys.add(k)) } catch {}
    })
    const zaExtraKeys = new Set()
    document.querySelectorAll('[data-za-extra-module]').forEach(el => {
      try {
        const j = JSON.parse(el.getAttribute('data-za-extra-module'))
        for (const [k, x] of Object.entries(j)) {
          zaExtraKeys.add(k)
          if (x && typeof x === 'object') Object.keys(x).forEach(k2 => zaExtraKeys.add(k + '.' + k2))
        }
      } catch {}
    })

    const items = [...document.querySelectorAll('.ContentItem')].slice(0, 60)
    const idBy = { zop: 0, microdata: 0, link: 0, react: 0 }
    let anyId = 0
    let agree = 0
    let inStore = 0
    let hasFiber = 0
    const reactPropKeys = new Set()
    const zopTypes = {}
    for (const el of items) {
      const ids = {}
      const zop = el.getAttribute('data-zop')
      if (zop) {
        try {
          const j = JSON.parse(zop)
          if (j.itemId != null) ids.zop = String(j.itemId)
          if (j.type) zopTypes[j.type] = (zopTypes[j.type] || 0) + 1
        } catch {}
      }
      const m1 = ID_RE.exec(el.querySelector('meta[itemprop="url"]')?.getAttribute('content') || '')
      if (m1) ids.microdata = m1[1]
      const a = el.querySelector('a[href*="/answer/"], a[href*="/p/"], a[href*="/pin/"], a[href*="/zvideo/"]')
      const m2 = ID_RE.exec(a?.getAttribute('href') || '')
      if (m2) ids.link = m2[1]
      const r = reactIds(el)
      if (r.hasFiber) {
        hasFiber++
        r.propKeys.forEach(k => reactPropKeys.add(k))
        const known = ids.zop || ids.microdata || ids.link
        if (known && r.ids.has(known)) ids.react = known
      }
      for (const k of Object.keys(idBy)) if (ids[k]) idBy[k]++
      const vals = [ids.zop, ids.microdata, ids.link].filter(Boolean)
      if (vals.length) {
        anyId++
        if (new Set(vals).size === 1) agree++
        if (idStore.has(vals[0])) inStore++
      }
    }

    const all = [...document.querySelectorAll('[class]')].slice(0, 3000)
    const hashed = all.filter(el => [...el.classList].some(c => /^css-[a-z0-9]+$/.test(c))).length

    send('anchors', {
      url: normalizeUrl(new URL(location.href)),
      counts,
      itemprop,
      zopKeys: [...zopKeys],
      zopTypes,
      zaExtraKeys: [...zaExtraKeys].slice(0, 40),
      items: items.length,
      idBy,
      anyId,
      agree,
      inStore,
      hasFiber,
      reactPropKeys: [...reactPropKeys].slice(0, 20),
      hashedClassRatio: all.length ? Math.round((hashed / all.length) * 100) / 100 : null,
      htmlAttrs: document.documentElement
        ? [...document.documentElement.attributes].map(a => (/^(data-theme|class)$/.test(a.name) ? `${a.name}=${a.value.slice(0, 40)}` : a.name))
        : [],
    })
  }

  let anchorTimer = null
  function scheduleAnchors(ms) {
    clearTimeout(anchorTimer)
    anchorTimer = setTimeout(probeAnchors, ms)
  }
  document.addEventListener('DOMContentLoaded', () => scheduleAnchors(2500))
  let lastScrollProbe = 0
  addEventListener('scroll', () => {
    if (performance.now() - lastScrollProbe < 5000) return
    lastScrollProbe = performance.now()
    scheduleAnchors(1500)
  }, { passive: true })

  // ---------- 6. MAIN 与 ISOLATED 之间的同步通信 ----------
  function runBridgeTest() {
    const N = 200
    const times = []
    let sync = 0
    let got = false
    const onPong = () => { got = true }
    document.addEventListener('zbp:pong-MAIN', onPong)
    for (let i = 0; i < N; i++) {
      got = false
      const t = performance.now()
      document.dispatchEvent(new CustomEvent('zbp:ping', { detail: JSON.stringify({ from: 'MAIN', i }) }))
      if (got) {
        sync++
        times.push(performance.now() - t)
      }
    }
    document.removeEventListener('zbp:pong-MAIN', onPong)
    document.dispatchEvent(new CustomEvent('zbp:objtest-MAIN', { detail: { from: 'MAIN' } }))
    send('bridge', { from: 'MAIN', n: N, sync, ...stats(times) })
  }

  send('env', {
    world: 'MAIN',
    userAgent: navigator.userAgent,
    documentElementAtStart: !!document.documentElement,
    appBootedAtStart: hasWebpack(),
    navigationApi: !!window.navigation,
    config,
  })
})()
