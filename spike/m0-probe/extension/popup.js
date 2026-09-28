const $ = id => document.getElementById(id)
const DEFAULT_CONFIG = { filterMode: 'off', initialDataMode: 'off', prehide: false }
const isFirefox = navigator.userAgent.includes('Firefox')

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function showTab() {
  const tab = await activeTab()
  try {
    const s = await chrome.tabs.sendMessage(tab.id, { type: 'tab-status' })
    $('tab').innerHTML = s.mainAlive
      ? '<span class="ok">知乎页面，探针运行中</span>'
      : '<span class="warn">知乎页面，但页面主环境脚本没有响应</span>'
  } catch {
    $('tab').innerHTML = '<span class="muted">不是知乎页面（或需要刷新页面）</span>'
  }
}

function showUserScripts(setup) {
  if (!setup) {
    $('us').textContent = '尚未检测'
    return
  }
  if (!setup.available) {
    $('us').innerHTML = isFirefox
      ? '<span class="warn">未授权</span>，请点"授予用户脚本权限"'
      : '<span class="warn">不可用</span>：请在扩展详情页打开"允许用户脚本"（旧版 Chrome 需打开开发者模式），然后点"重新检测"'
    return
  }
  const ok = setup.steps.registerWithWorldId === 'ok'
  $('us').innerHTML = ok
    ? '<span class="ok">可用，已注册 A、B 两个环境</span>，刷新知乎页面后开始测试'
    : '<span class="warn">部分可用</span>，详见报告'
}

async function loadConfig() {
  const { config = {} } = await chrome.storage.local.get('config')
  const c = { ...DEFAULT_CONFIG, ...config }
  $('filterMode').value = c.filterMode
  $('initialDataMode').value = c.initialDataMode
  $('prehide').checked = c.prehide
}

async function saveConfig() {
  await chrome.storage.local.set({
    config: { filterMode: $('filterMode').value, initialDataMode: $('initialDataMode').value, prehide: $('prehide').checked },
  })
}

$('filterMode').onchange = saveConfig
$('initialDataMode').onchange = saveConfig
$('prehide').onchange = saveConfig

$('recheck').onclick = async () => {
  $('us').textContent = '检测中…'
  showUserScripts(await chrome.runtime.sendMessage({ type: 'recheck-userscripts' }))
}

$('grant').hidden = !isFirefox
$('grant').onclick = async () => {
  const granted = await chrome.permissions.request({ permissions: ['userScripts'] })
  if (granted) showUserScripts(await chrome.runtime.sendMessage({ type: 'recheck-userscripts' }))
}

$('dark').onclick = async () => {
  const tab = await activeTab()
  $('darkResult').textContent = '测试中…'
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'dark-test' })
    $('darkResult').textContent = r.changed
      ? `页面颜色有变化（背景 ${r.before.bg} → ${r.after.bg}），3 秒后恢复`
      : '页面颜色没有变化：设置 data-theme 不起作用'
  } catch {
    $('darkResult').textContent = '请在知乎页面上使用'
  }
}

$('report').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('report.html') })

loadConfig()
showTab()
chrome.storage.local.get('report').then(({ report }) => showUserScripts(report?.userScripts?.setup))
