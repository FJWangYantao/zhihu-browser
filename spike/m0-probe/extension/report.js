const $ = id => document.getElementById(id)
let report = null

// ---------- DOM 小工具 ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v)
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c))
  return el
}
const chip = (text, tone) => h('span', { class: `chip ${tone}` }, text)
const code = text => h('code', {}, text)
function table(headers, rows) {
  if (!rows.length) return h('p', { class: 'muted' }, '（暂无数据）')
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, headers.map(x => h('th', {}, x)))),
    h('tbody', {}, rows.map(r => h('tr', {}, r.map(c => h('td', {}, c ?? '—')))))))
}
const raw = (label, value) => h('details', {}, h('summary', {}, label), h('pre', {}, JSON.stringify(value, null, 2)))
const yes = v => (v === true ? '是' : v === false ? '否' : '—')
const time = ts => (ts ? new Date(ts).toLocaleString() : '—')
function section(title, status, ...body) {
  return h('section', {}, h('h2', {}, title, status), ...body)
}
const status = (ok, partial, okText = '已测到', partialText = '部分', noneText = '未测到') =>
  ok ? chip(okText, 'ok') : partial ? chip(partialText, 'warn') : chip(noneText, 'bad')

const PAGE = { home: '首页推荐', follow: '关注', hot: '热榜', question: '问题页', answer: '回答页', article: '专栏文章', search: '搜索', people: '用户主页', collection: '收藏夹', pin: '想法', topic: '话题', video: '视频', other: '其他' }
const pageName = t => PAGE[t] || t || '—'

// ---------- 各部分 ----------
function secInitialData(r) {
  const pages = Object.entries(r.initialData)
  return section('1. 首屏数据（js-initialData）', status(pages.length >= 3, pages.length > 0, `${pages.length} 类页面`),
    h('p', { class: 'muted' }, '各类页面首屏数据的结构。至少覆盖：首页、问题页、回答页、专栏文章、搜索。'),
    table(['页面', '大小', '顶层字段', '实体数量'], pages.map(([pt, d]) => [
      pageName(pt),
      `${Math.round(d.bytes / 1024)} KB`,
      (d.topLevelKeys || []).join(', '),
      d.entityCounts ? Object.entries(d.entityCounts).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join(', ') : '—',
    ])),
    raw('结构详情', Object.fromEntries(pages.map(([pt, d]) => [pt, d.shape]))))
}

function secApi(r) {
  const entries = Object.entries(r.api).sort((a, b) => b[1].count - a[1].count)
  const loads = Object.values(r.pageLoads)
  const hooked = loads.reduce((s, x) => s + (x.coverage?.hooked || 0), 0)
  const perf = loads.reduce((s, x) => s + (x.coverage?.perf || 0), 0)
  const missed = [...new Set(loads.flatMap(x => x.coverage?.missed || []))]
  const lists = entries.filter(([, a]) => a.listLen != null)
  return section('2. 接口拦截与改写', status(entries.length > 0 && missed.length === 0 && perf > 0, entries.length > 0, `${entries.length} 个接口`),
    h('div', { class: 'grid' },
      h('p', {}, '拦截到的接口请求：', code(String(hooked))),
      h('p', {}, '浏览器记录的接口请求：', code(String(perf))),
      h('p', {}, '没拦截到的接口：', missed.length ? chip(missed.length + ' 个', 'bad') : chip('无', 'ok'))),
    missed.length ? h('p', {}, '没拦截到：', missed.join('，')) : null,
    r.hookErrors.length ? raw(`拦截出错 ${r.hookErrors.length} 次`, r.hookErrors) : null,
    h('h3', {}, '列表类接口'),
    table(['接口', '次数', '方式', '条目数', '分页字段', '签名头', '类型枚举'], lists.map(([key, a]) => [
      code(key), a.count, a.via.join('/'), a.listLen, (a.pagingKeys || []).join(', '), a.headers.join(', ') || '无',
      Object.entries(a.enums).map(([p, v]) => `${p}: ${Object.keys(v).join('/')}`).join('；'),
    ])),
    h('h3', {}, '过滤实验记录'),
    table(['时间', '页面', '接口', '模式', '条目（前 → 后）', '说明'], r.filterLog.slice().reverse().map(f => [
      time(f.at), pageName(f.pageType), code(f.endpoint), f.mode ?? '—',
      f.kind === 'filter' ? `${f.before} → ${f.after}` : '—',
      f.kind === 'filterContinue' ? `全部去掉后 ${f.afterMs} ms 内又请求了下一页` : f.isEnd ? '已是最后一页' : '',
    ])),
    raw('全部接口详情', r.api))
}

function secFirstScreen(r) {
  const timing = r.initialDataTiming
  const early = timing.filter(t => t.found && t.appBootedBeforeSeen === false).length
  return section('3. 首屏：改写数据与预隐藏', status(early > 0 && (r.rewrite.length > 0 || r.prehide.length > 0), timing.length > 0),
    h('p', { class: 'muted' }, '"读到首屏数据时知乎前端已启动"为"否"，说明有机会在前端启动前改写首屏数据。'),
    table(['页面', '读到时前端已启动', '之前已有外部脚本', '文档状态', '解析尝试次数', '改写', '改写时前端未启动'], timing.slice().reverse().map(t => [
      pageName(t.pageType), yes(t.appBootedBeforeSeen), t.externalScriptsBefore, t.readyState, t.parseAttempts, t.rewrite || '—', yes(t.rewriteBeforeAppBoot),
    ])),
    h('h3', {}, '改写实验结果'),
    table(['页面', '模式', '被删掉的回答仍显示', '页面错误', '未处理的 Promise 错误'], r.rewrite.slice().reverse().map(x => [
      pageName(x.pageType), x.mode, yes(x.removedAnswerStillRendered), x.errors, x.rejections,
    ])),
    h('h3', {}, '预隐藏实验结果'),
    table(['页面', '处理的元素', '批次', '隐藏样式生效的批次', '最慢一批（ms）', '首次处理（ms）', '超时放行', '页面错误'], r.prehide.slice().reverse().map(x => [
      pageName(x.pageType), x.processed, x.batches, x.hiddenBeforeMark, x.maxBatchMs, x.firstMarkMs, yes(x.timeoutFired), x.errors,
    ])))
}

function secAnchors(r) {
  const pages = Object.entries(r.anchors)
  const pct = (n, d) => (d ? `${n}/${d}（${Math.round((n / d) * 100)}%）` : '—')
  return section('4. 从内容元素找到数据', status(pages.some(([, a]) => a.items > 0 && a.anyId === a.items), pages.length > 0),
    h('p', { class: 'muted' }, '对每个 .ContentItem，分别用 data-zop、microdata、链接、React 属性找 id；"在数据中"表示该 id 出现在首屏数据或接口响应里。'),
    table(['页面', '内容元素', 'data-zop', 'microdata', '链接', 'React', '只有 React 有 id', '任一方式', '各方式一致', '不一致的组合', '在数据中', '哈希类名占比'], pages.map(([pt, a]) => [
      pageName(pt), a.items, pct(a.idBy.zop, a.items), pct(a.idBy.microdata, a.items), pct(a.idBy.link, a.items),
      pct(a.idBy.react, a.items), a.reactOnly ?? '—', pct(a.anyId, a.items), pct(a.agree, a.anyId),
      Object.entries(a.mismatch || {}).map(([k, n]) => `${k}×${n}`).join('，') || '—', pct(a.inStore, a.anyId), a.hashedClassRatio,
    ])),
    h('h3', {}, '选择器匹配数量'),
    table(['选择器', ...pages.map(([pt]) => pageName(pt))], Object.keys(pages[0]?.[1].counts || {}).map(sel => [code(sel), ...pages.map(([, a]) => a.counts[sel])])),
    table(['页面', 'itemprop', 'data-zop 字段', 'data-zop 类型', 'React 属性名'], pages.map(([pt, a]) => [
      pageName(pt),
      Object.entries(a.itemprop).map(([k, n]) => `${k}×${n}`).join(', '),
      a.zopKeys.join(', '),
      Object.entries(a.zopTypes || {}).map(([k, n]) => `${k}×${n}`).join(', '),
      a.reactPropKeys.join(', '),
    ])),
    raw('详情', r.anchors))
}

function secRoutes(r) {
  const rt = r.routes
  return section('5. 单页应用路由变化', status(rt.changes >= 5 && rt.pollOnly === 0, rt.changes > 0, `${rt.changes} 次`),
    h('p', { class: 'muted' }, '"只有轮询发现"的次数应为 0，否则说明监听 history 不够，需要别的手段。'),
    h('div', { class: 'grid' },
      h('p', {}, '最先发现：', Object.entries(rt.first).map(([k, n]) => `${k}×${n}`).join('，') || '—'),
      h('p', {}, '各方式发现次数：', Object.entries(rt.detectedBy).map(([k, n]) => `${k}×${n}`).join('，') || '—'),
      h('p', {}, '只有轮询发现：', code(String(rt.pollOnly)))),
    table(['从', '到', '最先发现', '各方式延迟（ms）'], rt.samples.slice().reverse().map(s => [
      pageName(s.from), pageName(s.to), s.first, Object.entries(s.by).map(([k, v]) => `${k}: ${v}`).join('，'),
    ])))
}

function secUserScripts(r) {
  const us = r.userScripts
  const s = us.setup
  const A = us.worlds.A
  const B = us.worlds.B
  const ok = s?.available && A && B && A.seesOtherWorldGlobal === false && A.domEvents?.sync === A.domEvents?.n
  const worldRow = (name, w) => w ? [
    name, yes(w.seesPageGlobals), yes(w.seesIsolatedGlobal), yes(w.seesOtherWorldGlobal),
    `${w.domEvents.sync}/${w.domEvents.n}，中位 ${w.domEvents.median} ms，p95 ${w.domEvents.p95} ms`,
    w.runtimeMessaging ? `中位 ${w.runtimeMessaging.median} ms，p95 ${w.runtimeMessaging.p95} ms` : (w.runtimeMessagingError || '—'),
    yes(w.customElements),
  ] : [name, '（没有收到结果）', '', '', '', '', '']
  const main = r.bridge.MAIN
  return section('6. 用户脚本环境（userScripts）与跨环境通信', status(ok, s?.available || main),
    s ? h('div', { class: 'grid' },
      h('p', {}, '可用：', s.available ? chip('是', 'ok') : chip('否', 'bad'), s.error ? ` ${s.error}` : ''),
      ...Object.entries(s.steps || {}).map(([k, v]) => h('p', {}, `${k}：`, v === 'ok' ? chip('ok', 'ok') : h('span', { class: 'bad' }, v))),
      h('p', {}, 'onUserScriptMessage：', yes(s.hasOnUserScriptMessage)),
      h('p', {}, 'userScripts.execute：', yes(s.hasExecute))) : h('p', { class: 'muted' }, '尚未检测'),
    table(['环境', '看得到页面全局变量', '看得到 ISOLATED 全局变量', '看得到另一个用户环境', '与 ISOLATED 同步通信', '扩展消息往返', 'customElements'], [
      worldRow('A', A), worldRow('B', B),
      main ? ['MAIN', '—', '—', '—', `${main.sync}/${main.n}，中位 ${main.median} ms，p95 ${main.p95} ms`, '—', '—'] : ['MAIN', '（没有收到结果）', '', '', '', '', ''],
    ]),
    h('p', {}, 'ISOLATED 环境里 customElements 可用：', yes(r.env.ISOLATED?.customElements)),
    h('p', {}, '对象形式的事件数据跨环境可读：',
      ['MAIN', 'A', 'B'].map(w => r.bridge['object-' + w] ? `${w}: ${yes(r.bridge['object-' + w].readable)}（${r.bridge['object-' + w].type}）` : `${w}: —`).join('，')),
    h('p', {}, 'userScripts.execute 向已有环境 A 执行代码：',
      us.execute ? (us.execute.ok ? `成功，与注册的 A 是同一环境：${yes(us.execute.sameWorldAsRegisteredA)}` : `失败：${us.execute.error}`) : '—'))
}

function secDark(r) {
  return section('7. 知乎自带暗色', status(r.dark.some(d => d.changed), r.dark.length > 0, '有效', '无变化', '未测试'),
    h('p', { class: 'muted' }, '在弹窗里点"测试知乎自带暗色"：切换 <html data-theme>，比较页面颜色。'),
    table(['时间', '页面', '切换前', '切换后', '颜色变化'], r.dark.slice().reverse().map(d => [
      time(d.at), d.url, `${d.before.theme ?? '无'} / ${d.before.bg}`, `${d.after.theme} / ${d.after.bg}`, yes(d.changed),
    ])),
    Object.values(r.anchors)[0] ? h('p', {}, '<html> 上的属性：', Object.values(r.anchors)[0].htmlAttrs.join(', ')) : null)
}

function secEnv(r) {
  const m = r.env.MAIN
  const i = r.env.ISOLATED
  const errs = Object.values(r.pageLoads)
  return section('8. 浏览器与页面稳定性', status(!!m && !!i, !!m || !!i, '已运行'),
    h('div', { class: 'grid' },
      h('p', {}, '页面主环境脚本运行：', yes(!!m)),
      h('p', {}, '扩展隔离环境脚本运行：', yes(!!i)),
      h('p', {}, '浏览器：', i?.brands?.join('，') || m?.userAgent || '—'),
      h('p', {}, 'Navigation API：', yes(m?.navigationApi)),
      h('p', {}, 'document_start 时已有 <html>：', yes(m?.documentElementAtStart))),
    h('h3', {}, '最近的页面（实验配置与错误数）'),
    table(['时间', '打开的页面', '过滤', '首屏改写', '预隐藏', '页面错误', 'Promise 错误', '错误示例'], errs.slice().reverse().map(x => [
      time(x.at), pageName(x.landingPageType || x.pageType), x.config?.filterMode, x.config?.initialDataMode, yes(x.config?.prehide),
      x.errors, x.rejections, (x.errorSamples || []).join(' | '),
    ])))
}

const QUESTIONS = [
  ['filterContinue', '过滤选"去掉全部条目"时，往下滚动还能继续加载吗？'],
  ['filterPage', '过滤开启时，页面有没有异常（空白、报错、卡住）？'],
  ['prehide', '预隐藏开启时，首屏有没有闪烁，或者空白时间过长？'],
  ['rewrite', '首屏数据改写开启时，页面是否正常？'],
  ['dark', '暗色测试时，页面看起来是否完整变暗？'],
]
function secManual(r) {
  const m = r.manual || {}
  const selects = QUESTIONS.map(([key, q]) => h('label', {}, q,
    h('select', { 'data-key': key }, ['', '是', '否', '部分', '没测'].map(v => {
      const o = h('option', { value: v }, v || '请选择')
      if (m[key] === v) o.selected = true
      return o
    }))))
  const notes = h('textarea', { placeholder: '其他发现、截图说明等' })
  notes.value = m.notes || ''
  const saved = h('span', { class: 'muted' })
  return section('人工观察', null,
    h('p', { class: 'muted' }, '有些结果只能靠眼睛看，请在这里记录，会一起导出。'),
    ...selects, notes,
    h('p', {}, h('button', {
      class: 'primary',
      onclick: async () => {
        const manual = { notes: notes.value }
        selects.forEach(l => { const s = l.querySelector('select'); manual[s.dataset.key] = s.value })
        await chrome.runtime.sendMessage({ type: 'save-manual', manual })
        saved.textContent = ' 已保存'
      },
    }, '保存'), saved))
}

// ---------- 渲染与导出 ----------
function render() {
  const root = $('root')
  root.replaceChildren()
  if (!report) {
    root.append(h('p', { class: 'muted' }, '还没有数据。打开知乎页面浏览一会儿再回来。'))
    return
  }
  $('meta').textContent = `开始于 ${time(report.createdAt)}，最后更新 ${time(report.updatedAt)}`
  for (const fn of [secInitialData, secApi, secFirstScreen, secAnchors, secRoutes, secUserScripts, secDark, secEnv, secManual]) {
    try {
      root.append(fn(report))
    } catch (e) {
      root.append(h('section', {}, h('p', { class: 'bad' }, `这一部分渲染出错：${e.message}`)))
    }
  }
}

async function load() {
  ;({ report = null } = await chrome.storage.local.get('report'))
  render()
}

$('download').onclick = () => {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const a = h('a', { href: URL.createObjectURL(blob), download: `m0-probe-report-${new Date().toISOString().slice(0, 10)}.json` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
$('copy').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
  $('copy').textContent = '已复制'
  setTimeout(() => { $('copy').textContent = '复制 JSON' }, 1500)
}
$('clear').onclick = async () => {
  if (!confirm('清空所有已记录的数据？')) return
  await chrome.runtime.sendMessage({ type: 'clear-report' })
  load()
}

// 数据更新时自动刷新（正在填写人工观察时不打断）
let timer = null
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.report) return
  if (document.activeElement && /^(TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return
  clearTimeout(timer)
  timer = setTimeout(load, 1000)
})
load()
