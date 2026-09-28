// M0 探针：扩展隔离环境（ISOLATED world）部分。
// 负责：把配置同步给 main-world.js、转发各环境的记录给后台、响应通信延迟测试、暗色测试。
(() => {
  'use strict'

  // 让用户脚本环境检查自己是否看得到这里的全局变量（应该看不到）
  globalThis.__zbpIsolated = true

  let mainAlive = false
  let forwarded = 0

  // ---------- 配置同步：main-world.js 在 document_start 同步读取 localStorage ----------
  function applyConfig(c) {
    try {
      localStorage.setItem('zbp-config', JSON.stringify(c || {}))
    } catch {}
  }
  chrome.storage.local.get('config').then(r => applyConfig(r.config)).catch(() => {})
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.config) applyConfig(changes.config.newValue)
  })

  // ---------- 记录转发 ----------
  let buf = []
  function push(kind, data) {
    buf.push({ kind, loadId: 'isolated', pageType: null, t: 0, data })
  }
  function flush() {
    if (!buf.length) return
    const recs = buf
    buf = []
    forwarded += recs.length
    try {
      chrome.runtime.sendMessage({ type: 'records', recs }).catch(() => {})
    } catch {
      // 扩展被重新加载后，旧页面里的脚本会失效，忽略即可
    }
  }
  setInterval(flush, 1000)
  addEventListener('pagehide', flush)

  document.addEventListener('zbp:record', e => {
    mainAlive = true
    if (typeof e.detail !== 'string') return
    try {
      const rec = JSON.parse(e.detail)
      buf.push(rec)
      // 页面关闭前发出的状态记录要立即转发，否则可能来不及
      if (rec.kind === 'status') flush()
    } catch {}
  })

  // ---------- 同步通信测试：收到 ping 立即回 pong ----------
  document.addEventListener('zbp:ping', e => {
    if (typeof e.detail !== 'string') return
    let from
    try {
      from = JSON.parse(e.detail).from
    } catch {}
    if (from === 'MAIN' || from === 'A' || from === 'B') document.dispatchEvent(new CustomEvent('zbp:pong-' + from))
  })
  // 对象形式的 detail 跨环境后还能不能读到
  for (const from of ['MAIN', 'A', 'B']) {
    document.addEventListener('zbp:objtest-' + from, e => {
      const d = e.detail
      let value = null
      try {
        value = d && d.from
      } catch {}
      push('bridgeObject', { from, type: d === null ? 'null' : typeof d, readable: value === from })
    })
  }

  // ---------- 与 main-world.js 握手（两边谁先运行都可以） ----------
  const ready = () => document.dispatchEvent(new CustomEvent('zbp:isolated-ready'))
  document.addEventListener('zbp:main-ready', () => {
    mainAlive = true
    ready()
  })
  ready()

  push('env', {
    world: 'ISOLATED',
    customElements: typeof customElements !== 'undefined' && customElements !== null,
    brands: navigator.userAgentData?.brands?.map(b => `${b.brand} ${b.version}`) ?? null,
    platform: navigator.userAgentData?.platform ?? null,
  })

  // 让后台测试 userScripts.execute（能否在已打开的页面里、向已有的用户脚本环境执行代码）
  setTimeout(() => {
    try {
      chrome.runtime.sendMessage({ type: 'page-hello' }).catch(() => {})
    } catch {}
  }, 2500)

  // 地址里的数字 id 和用户标识替换掉
  function safePath(path) {
    return path
      .split('/')
      .map((seg, i, arr) => {
        if (!seg) return seg
        if (/^\d+$/.test(seg)) return ':id'
        if (/^(people|org)$/.test(arr[i - 1] || '') || (/\d/.test(seg) && seg.includes('-'))) return ':token'
        return seg
      })
      .join('/')
  }

  // ---------- 7. 暗色测试：切换 <html data-theme>，看页面颜色是否变化，3 秒后恢复 ----------
  async function runDarkTest() {
    const html = document.documentElement
    const read = () => ({
      theme: html.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
    })
    const before = read()
    const target = before.theme === 'dark' ? 'light' : 'dark'
    html.setAttribute('data-theme', target)
    await new Promise(r => setTimeout(r, 400))
    const after = read()
    setTimeout(() => {
      if (before.theme === null) html.removeAttribute('data-theme')
      else html.setAttribute('data-theme', before.theme)
    }, 3000)
    const result = {
      url: location.hostname + safePath(location.pathname),
      before,
      after,
      changed: before.bg !== after.bg || before.text !== after.text,
    }
    push('dark', result)
    flush()
    return result
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'tab-status') {
      sendResponse({ mainAlive, forwarded, url: location.hostname + location.pathname })
    } else if (msg?.type === 'dark-test') {
      runDarkTest().then(sendResponse)
      return true
    }
  })
})()
