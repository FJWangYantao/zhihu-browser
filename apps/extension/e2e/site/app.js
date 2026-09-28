// 模拟的知乎前端：用 fetch / XHR 请求接口并渲染卡片，启动后给元素加上 React 的内部属性（模拟激活）。
// 结构参照 docs/spike-report.md 里记录的锚点：.TopstoryItem > .ContentItem[data-zop]、.List-item、microdata。
;(() => {
  const app = { pages: 0, rendered: 0, ads: 0, xhrItems: 0 }
  window.__app = app
  const fiber = el => {
    el.__reactFiber$mock = { memoizedProps: {} }
  }
  const hydrate = () => document.querySelectorAll('#root, #root *').forEach(fiber)

  function card(target, wrapperClass) {
    const url =
      target.type === 'answer'
        ? `https://www.zhihu.com/question/${target.question.id}/answer/${target.id}`
        : `https://zhuanlan.zhihu.com/p/${target.id}`
    const title = target.type === 'answer' ? target.question.title : target.title
    const wrapper = document.createElement('div')
    wrapper.className = wrapperClass
    const item = document.createElement('div')
    item.className = `ContentItem ${target.type === 'answer' ? 'AnswerItem' : 'ArticleItem'}`
    item.dataset.zop = JSON.stringify({
      authorName: target.author.name,
      itemId: Number(target.id),
      title,
      type: target.type,
    })
    item.innerHTML = `
      <h2 class="ContentItem-title"><a href="${url}"></a></h2>
      <div itemprop="author" itemscope><meta itemprop="name" content=""><meta itemprop="url" content="https://www.zhihu.com/people/${target.author.url_token}"></div>
      <meta itemprop="url" content="${url}">
      <div class="RichContent is-collapsed"><div class="RichContent-inner"><div class="RichText ztext"></div></div><button class="ContentItem-more">阅读全文</button></div>
      <div class="ContentItem-actions"><button class="Button VoteButton">赞同 ${target.voteup_count}</button><button class="ContentItem-rightButton">收起</button></div>`
    item.querySelector('a').textContent = title
    item.querySelector('meta[itemprop="name"]').setAttribute('content', target.author.name)
    // 模拟数据里的正文是固定的几段文字
    item.querySelector('.RichText').innerHTML = target.content
    wrapper.append(item)
    wrapper.querySelectorAll('*').forEach(fiber)
    return wrapper
  }

  // ---------- 首页：推荐流 ----------
  const feed = document.getElementById('feed')
  let page = 1
  async function loadMore() {
    const res = await fetch(`/api/v3/feed/topstory/recommend?page_number=${page}&limit=6`, {
      headers: { 'x-zse-93': '101_3_3.0', 'x-zse-96': '2.0_fake' },
    })
    const json = await res.json()
    page++
    app.pages++
    for (const item of json.data) {
      if (item.type === 'feed_advert') {
        const ad = document.createElement('div')
        ad.className = 'TopstoryItem ad-card'
        ad.textContent = '广告'
        feed.append(ad)
        app.ads++
      } else {
        feed.append(card(item.target, 'Card TopstoryItem'))
        app.rendered++
      }
    }
  }
  app.loadMore = loadMore

  // ---------- 问题页：服务端渲染的回答 + 用 XHR 加载更多 ----------
  function loadAnswers() {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', '/api/v4/questions/9/feeds?cursor=abc&limit=5')
    xhr.setRequestHeader('x-zse-96', '2.0_fake')
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return
      const json = JSON.parse(xhr.responseText)
      for (const item of json.data) {
        document.getElementById('answers').append(card(item.target, 'List-item'))
        app.xhrItems++
      }
    }
    xhr.send()
  }

  // "阅读全文"和"收起"：切换正文的折叠（样式在 site.css）
  document.addEventListener('click', event => {
    const button = event.target.closest?.('.ContentItem-more, .ContentItem-rightButton')
    const rich = button?.closest('.ContentItem')?.querySelector('.RichContent')
    if (!rich) return
    rich.classList.toggle('is-collapsed', button.matches('.ContentItem-rightButton'))
    app.toggles = (app.toggles ?? 0) + 1
  })

  // 模拟脚本加载和激活需要一点时间
  setTimeout(() => {
    hydrate()
    if (feed) loadMore()
    if (document.getElementById('answers')) loadAnswers()
  }, 300)
})()
