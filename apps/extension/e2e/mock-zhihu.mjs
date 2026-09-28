// 本地模拟的知乎：首页推荐流、问题页（服务端渲染的回答 + 用接口加载更多）和对应的接口。
// 数据结构取自 M0 记录的真实接口结构（docs/spike-report.md），数值都是编造的。
// 页面带严格的 CSP（不允许内联脚本和内联样式），检验扩展在 CSP 下正常工作。

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const T0 = 1_700_000_000
const AUTHORS = [1, 2, 3].map(n => ({
  id: `a${n}hash`,
  url_token: `user-${n}`,
  name: `用户${n}`,
  headline: '一句话介绍',
  avatar_url: '',
  is_org: false,
  type: 'people',
  user_type: 'people',
}))
const authorOf = id => AUTHORS[id % 3]

export function answer(id, question) {
  const title = id % 5 === 0 ? `营销号怎么写文案 ${id}` : `普通问题 ${id}`
  return {
    id: String(id),
    type: 'answer',
    answer_type: 'normal',
    url: `https://api.zhihu.com/answers/${id}`,
    author: authorOf(id),
    question: question ?? { id: `9${id}`, type: 'question', title, url: '' },
    content: `<p>回答正文 ${id}</p>`,
    excerpt: `回答摘要 ${id}`,
    created_time: T0,
    updated_time: T0,
    voteup_count: id * 10,
    comment_count: 1,
  }
}

function article(id) {
  return {
    id: String(id),
    type: 'article',
    title: `文章 ${id}`,
    author: authorOf(id),
    content: '<p>文章正文</p>',
    excerpt: `文章摘要 ${id}`,
    created: T0,
    updated: T0,
    voteup_count: 5,
    comment_count: 0,
  }
}

/** 第 page 页推荐：6 条（第 6 条是文章），第 1 页第 3 条是广告 */
export function recommend(page) {
  const data = []
  for (let i = 1; i <= 6; i++) {
    const id = page * 10 + i
    data.push({
      id: `feed-${id}`,
      type: 'feed',
      verb: 'TOPIC_ACKNOWLEDGED_ANSWER',
      target: i === 6 ? article(id) : answer(id),
    })
  }
  if (page === 1)
    data.splice(2, 0, { id: 'ad-1', type: 'feed_advert', ad: { brand: { type: 'brand', name: '某品牌' } } })
  return {
    data,
    paging: { is_end: page >= 5, next: `https://www.zhihu.com/api/v3/feed/topstory/recommend?page_number=${page + 1}` },
  }
}

const QUESTION = { id: '9', type: 'question', title: '问题九', url: '' }
export const SSR_ANSWERS = [901, 902, 903]
export const MORE_ANSWERS = [904, 905, 906, 907, 908]

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

function ssrAnswer(id) {
  const a = answer(id, QUESTION)
  const url = `https://www.zhihu.com/question/9/answer/${id}`
  const zop = JSON.stringify({ authorName: a.author.name, itemId: id, title: QUESTION.title, type: 'answer' })
  return `<div class="List-item"><div class="ContentItem AnswerItem" data-zop="${escapeHtml(zop)}" itemprop="answer" itemscope>
  <div itemprop="author" itemscope><meta itemprop="name" content="${a.author.name}"><meta itemprop="url" content="https://www.zhihu.com/people/${a.author.url_token}"></div>
  <meta itemprop="url" content="${url}">
  <div class="RichContent"><div class="RichContent-inner">${a.content}</div></div>
  <div class="ContentItem-actions"><button class="Button VoteButton">赞同 ${a.voteup_count}</button></div>
</div></div>`
}

function camel(a) {
  return {
    id: a.id,
    type: 'answer',
    author: { id: a.author.id, urlToken: a.author.url_token, name: a.author.name, headline: a.author.headline },
    question: { id: '9', title: QUESTION.title },
    content: a.content,
    excerpt: a.excerpt,
    createdTime: a.created_time,
    updatedTime: a.updated_time,
    voteupCount: a.voteup_count,
    commentCount: a.comment_count,
  }
}

function page(body, initialState) {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>模拟知乎</title></head>
<body>
${body}
<script id="js-initialData" type="text/json">${JSON.stringify({ initialState, subAppName: 'main' })}</script>
<script src="/static/app.js"></script>
</body></html>`
}

const HOME = page(
  '<div id="root"><header class="AppHeader">知乎</header><main><div id="feed" class="Topstory-recommend"></div></main></div>',
  {
    entities: { users: { me: { id: 'me', userType: 'people' } } },
  },
)

const QUESTION_PAGE = page(
  `<div id="root"><div class="QuestionHeader"><h1 class="QuestionHeader-title">${QUESTION.title}</h1></div><div id="answers">${SSR_ANSWERS.map(ssrAnswer).join('')}</div></div>`,
  {
    entities: {
      answers: Object.fromEntries(SSR_ANSWERS.map(id => [id, camel(answer(id, QUESTION))])),
      questions: { 9: { id: '9', type: 'question', title: QUESTION.title, answerCount: 8, followerCount: 10 } },
    },
  },
)

export function startMockZhihu(port) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://www.zhihu.com')
    const json = body => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    if (u.pathname === '/api/v3/feed/topstory/recommend')
      return json(recommend(Number(u.searchParams.get('page_number')) || 1))
    if (u.pathname === '/api/v4/questions/9/feeds') {
      return json({
        data: MORE_ANSWERS.map((id, i) => ({
          type: 'question_feed_card',
          target_type: 'answer',
          cursor: `c${i}`,
          target: answer(id, QUESTION),
        })),
        paging: { is_end: true },
      })
    }
    if (u.pathname.startsWith('/api/')) return json({ data: [], paging: { is_end: true } })
    if (u.pathname === '/static/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      return res.end(fs.readFileSync(path.join(here, 'site/app.js')))
    }
    if (u.pathname === '/favicon.ico') {
      res.writeHead(204)
      return res.end()
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'self'; style-src 'self'",
    })
    res.end(u.pathname.startsWith('/question/') ? QUESTION_PAGE : HOME)
  })
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => resolve({ close: () => new Promise(r => server.close(r)) }))
  })
}
