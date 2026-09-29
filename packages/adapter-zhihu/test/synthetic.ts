// 合成的页面样本：按 docs/spike-report.md 记录的知乎页面结构手工搭建，不是从真实页面采集的。
// 用途：让 fixtures 测试的整条流水线（采集 → 脱敏 → 装载 → 检查）在没有真实样本时也能运行；
// 真实页面的样本用命令面板的"采集页面样本"采集，放进 test/pages/（见 docs/fixtures.md）。
// 这些样本由 synthetic.test.ts 生成：UPDATE_FIXTURES=1 pnpm test 会重新写入 test/pages/synthetic-*.json。

import { feedCard, hotItem, listItem } from './page'

export interface SyntheticPage {
  name: string
  url: string
  body: string
  /** 采集时实体仓库里有的键 */
  entities: string[]
  /** 元素的位置和大小：选择器 → [x, y, 宽, 高]；同一个选择器命中多个元素时，依次往下排 */
  layout: [selector: string, rect: [number, number, number, number]][]
}

const header = '<header class="AppHeader"><a href="/">知乎</a><a href="/hot">热榜</a></header>'
const side = (cls: string) => `<div class="${cls}"><div class="Card">右侧栏</div></div>`

const question = (id: string, title: string) =>
  `<div class="QuestionHeader"><div class="QuestionHeader-content"><div class="QuestionHeader-main"><h1 class="QuestionHeader-title">${title}</h1><div class="QuestionHeader-detail">问题描述</div></div><div class="QuestionHeader-side"></div></div></div><meta itemprop="url" content="https://www.zhihu.com/question/${id}">`

/** 同一个选择器命中的多个元素从上到下依次排开（见 mountSynthetic） */
const stack = (selector: string, x: number, w: number, h: number, y0: number): SyntheticPage['layout'][number][] => [
  [selector, [x, y0, w, h]],
]

export const SYNTHETIC_PAGES: SyntheticPage[] = [
  {
    name: 'home',
    url: 'https://www.zhihu.com/',
    // 右侧栏只有自动生成的类名、主栏外面还包着一层（M1 实测首页的结构）
    body: `<div id="root">${header}<main class="Topstory"><div class="Topstory-container"><div class="ListShortcut"><div class="Topstory-mainColumn"><div class="Topstory-recommend">${[
      feedCard('answer', '1001', { title: '首页的第一个问题', author: '甲', questionId: '2001' }),
      feedCard('answer', '1002', { title: '首页的第二个问题', author: '乙', questionId: '2002' }),
      feedCard('article', '4001', { title: '一篇推荐的文章', author: '丙' }),
      feedCard('answer', '1003', { title: '首页的第三个问题', author: '甲', questionId: '2003' }),
    ].join('')}</div></div></div><div class="css-1qyytj7"><div class="Card">右侧栏</div></div></div></main></div>`,
    entities: ['answer:1001', 'answer:1002', 'answer:1003', 'article:4001'],
    layout: [
      ['body', [0, 0, 1024, 3000]],
      ['.Topstory-container', [100, 60, 900, 2900]],
      ['.ListShortcut', [100, 60, 640, 2900]],
      ['.Topstory-mainColumn', [100, 60, 640, 2900]],
      ['.css-1qyytj7', [760, 60, 240, 400]],
      ...stack('.ContentItem', 100, 640, 300, 60),
    ],
  },
  {
    name: 'question',
    url: 'https://www.zhihu.com/question/2001',
    body: `<div id="root">${header}${question('2001', '一个被很多人回答的问题')}<main class="Question-main"><div class="Question-mainColumn"><div class="List">${[
      listItem('answer', '1001', { title: '一个被很多人回答的问题', author: '甲', questionId: '2001' }),
      listItem('answer', '1002', { title: '一个被很多人回答的问题', author: '乙', questionId: '2001' }),
      listItem('answer', '1003', { title: '一个被很多人回答的问题', author: '丙', questionId: '2001' }),
    ].join('')}</div></div>${side('Question-sideColumn')}</main></div>`,
    entities: ['question:2001', 'answer:1001', 'answer:1002', 'answer:1003'],
    layout: [
      ['body', [0, 0, 1024, 2400]],
      ['.QuestionHeader', [0, 60, 1024, 200]],
      ['.Question-main', [100, 280, 900, 2100]],
      ['.Question-mainColumn', [100, 280, 640, 2100]],
      ['.Question-sideColumn', [760, 280, 240, 500]],
      ...stack('.ContentItem', 100, 640, 600, 280),
    ],
  },
  {
    name: 'answer',
    url: 'https://www.zhihu.com/question/2001/answer/1001',
    body: `<div id="root">${header}${question('2001', '一个被很多人回答的问题')}<main class="Question-main"><div class="Question-mainColumn">${listItem('answer', '1001', { title: '一个被很多人回答的问题', author: '甲', questionId: '2001' })}<a class="QuestionMainAction" href="/question/2001">查看全部 42 个回答</a></div>${side('Question-sideColumn')}</main></div>`,
    entities: ['question:2001', 'answer:1001'],
    layout: [
      ['body', [0, 0, 1024, 1200]],
      ['.QuestionHeader', [0, 60, 1024, 200]],
      ['.Question-main', [100, 280, 900, 900]],
      ['.Question-mainColumn', [100, 280, 640, 900]],
      ['.Question-sideColumn', [760, 280, 240, 500]],
      ['.ContentItem', [100, 280, 640, 700]],
    ],
  },
  {
    name: 'article',
    url: 'https://zhuanlan.zhihu.com/p/4001',
    // 专栏文章页没有 .ContentItem：文章本身带 data-zop，评论是带 data-id 的元素
    body: `<div id="root">${header}<main class="App-main"><article class="Post-content" data-zop='{"authorName":"丙","itemId":4001,"title":"一篇专栏文章","type":"article"}'><header class="Post-Header"><h1 class="Post-Title">一篇专栏文章</h1><div class="AuthorInfo"><a href="/people/user-3">丙</a></div></header><div class="Post-RichTextContainer"><div class="RichText ztext"><p>文章正文第一段</p><p>文章正文第二段</p></div></div><div class="Comments-container"><div class="css-comment" data-id="7001"><a href="/people/user-1">甲</a><div class="RichText">第一条评论</div></div><div class="css-comment" data-id="7002"><a href="/people/user-2">乙</a><div class="RichText">第二条评论</div></div></div></article></main></div>`,
    entities: ['article:4001', 'comment:7001', 'comment:7002'],
    layout: [
      ['body', [0, 0, 1024, 1600]],
      ['.Post-content', [200, 60, 640, 1500]],
      ['.css-comment', [200, 900, 640, 80]],
    ],
  },
  {
    name: 'search',
    url: 'https://www.zhihu.com/search?q=%E5%85%B3%E9%94%AE%E8%AF%8D&type=content',
    body: `<div id="root">${header}<main class="Search-container"><div class="SearchMain"><div class="List">${[
      listItem('answer', '1001', { title: '搜索结果一', author: '甲', questionId: '2001' }),
      listItem('answer', '1002', { title: '搜索结果二', author: '乙', questionId: '2002' }),
      // 搜索页的想法卡片没有 data-zop
      `<div class="List-item">${feedCard('pin', '6001', { title: '', author: '丙', noZop: true })}</div>`,
    ].join('')}</div></div>${side('SearchSideBar')}</main></div>`,
    entities: ['answer:1001', 'answer:1002', 'pin:6001'],
    layout: [
      ['body', [0, 0, 1024, 1800]],
      ['.Search-container', [100, 60, 900, 1700]],
      ['.SearchMain', [100, 60, 640, 1700]],
      ['.SearchSideBar', [760, 60, 240, 300]],
      ...stack('.ContentItem', 100, 640, 400, 60),
    ],
  },
  {
    name: 'hot',
    url: 'https://www.zhihu.com/hot',
    // 热榜没有 data-zop，靠标题链接和数据对应
    body: `<div id="root">${header}<main class="Topstory"><div class="Topstory-container"><div class="Topstory-mainColumn"><div class="HotList">${[
      hotItem('2001', '热榜第一条'),
      hotItem('2002', '热榜第二条'),
      hotItem('2003', '热榜第三条'),
    ]
      .map(item => `<div class="Card">${item}</div>`)
      .join('')}</div></div>${side('GlobalSideBar')}</div></main></div>`,
    entities: [],
    layout: [
      ['body', [0, 0, 1024, 1200]],
      ['.Topstory-container', [100, 60, 900, 1100]],
      ['.Topstory-mainColumn', [100, 60, 640, 1100]],
      ['.GlobalSideBar', [760, 60, 240, 300]],
      ...stack('.HotItem', 100, 640, 120, 60),
    ],
  },
]

/** 把合成页面装进当前文档，并让 getBoundingClientRect 按 layout 返回（happy-dom 自己不做布局） */
export function mountSynthetic(spec: SyntheticPage): void {
  document.documentElement.removeAttribute('data-theme')
  document.body.innerHTML = spec.body
  for (const [selector, [x, y0, w, h]] of spec.layout) {
    const els = selector === 'body' ? [document.body] : [...document.querySelectorAll(selector)]
    els.forEach((el, i) => {
      const y = y0 + i * (h + 20)
      el.getBoundingClientRect = () =>
        ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect
    })
  }
}
