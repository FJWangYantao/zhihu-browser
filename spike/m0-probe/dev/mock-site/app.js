// 模拟知乎前端：读取首屏数据、用 fetch 和 XHR 加载列表、单页路由跳转
self.webpackChunkheifetz = self.webpackChunkheifetz || []
const state = JSON.parse(document.getElementById('js-initialData').textContent)
window.__app = { fetchItems: 0, xhrItems: 0, pagesLoaded: 0 }

// "水合"：首屏数据里没有的回答，从页面上去掉
document.querySelectorAll('.ContentItem').forEach(el => {
  const id = JSON.parse(el.dataset.zop).itemId
  if (!state.initialState.entities.answers[id]) el.closest('.TopstoryItem').remove()
})

const list = document.getElementById('list')
function render(targets) {
  for (const t of targets) {
    const item = document.createElement('div')
    item.className = 'TopstoryItem'
    item.innerHTML = `<div class="ContentItem AnswerItem css-1abcde" data-zop='{"itemId":${t.id},"type":"answer"}'>
      <meta itemprop="url" content="https://www.zhihu.com/question/9/answer/${t.id}"><a href="/question/9/answer/${t.id}">回答</a></div>`
    list.append(item)
  }
}

let page = 2
async function loadMore() {
  const r = await fetch(`/api/v3/feed/topstory/recommend?page_number=${page}&limit=6`, {
    headers: { 'x-zse-93': '101_3_3.0', 'x-zse-96': '2.0_fake' },
  })
  const j = await r.json()
  page++
  window.__app.pagesLoaded++
  window.__app.fetchItems += j.data.length
  render(j.data.map(d => d.target))
  // 一页全部被去掉时自动加载下一页
  if (j.data.length === 0 && !j.paging.is_end && window.__app.pagesLoaded < 3) loadMore()
}

function loadAnswersByXhr() {
  const x = new XMLHttpRequest()
  x.open('GET', '/api/v4/questions/1/feeds?cursor=abc&limit=5')
  x.setRequestHeader('x-zse-96', '2.0_fake')
  x.onreadystatechange = () => {
    if (x.readyState !== 4) return
    const j = JSON.parse(x.responseText)
    window.__app.xhrItems += j.data.length
    render(j.data.map(d => d.target))
  }
  x.send()
}

loadMore()
loadAnswersByXhr()

// 用户主页：接口地址里带着用户标识（检验探针会把它们抹掉）
const person = /^\/people\/([^/]+)/.exec(location.pathname)
if (person) {
  fetch(`/api/v3/moments/${person[1]}/activities?limit=5`)
  fetch(`/api/v4/profile/${person[1]}/infinity`)
  fetch('/api/v3/moments/extra')
  fetch('/api/v4/somewhere/purelettertoken')
}
// 以内容网址为键的映射（真实知乎的 link_card_info）：检验网址里的内容 id 不会进入报告
fetch('/api/v4/editor/link_card_infos?scene=answer&urls=x')
setTimeout(() => history.pushState({}, '', '/question/1'), 1500)
setTimeout(() => history.pushState({}, '', '/search?q=test'), 2500)
setTimeout(() => history.back(), 3500)
