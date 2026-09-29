import { afterEach, describe, expect, test } from 'vitest'
import { pageInfo } from '../src/routes'
import { auditSnapshot, Scrubber, scrubText, shape, snapshotPage, stringifySnapshot } from '../src/snapshot'
import { feedCard, flush, html, type Setup, setup } from './page'

let s: Setup | undefined
afterEach(() => {
  s?.dispose()
  s = undefined
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-theme')
})

/** 一个带满了敏感信息的页面：用来检查脱敏之后一个都不剩 */
const SECRETS = [
  '某某某的私密回答',
  '张三丰',
  'zhang-san-feng',
  '987654321',
  'https://pic1.zhimg.com/avatar.jpg',
  'secret@mail.com',
]

function privatePage(): string {
  return `<div id="root" data-tracking="track-1234" style="color:red">
  <header class="AppHeader"><a href="https://www.zhihu.com/people/zhang-san-feng?utm=abc" aria-label="张三丰的主页"><img src="https://pic1.zhimg.com/avatar.jpg" alt="张三丰"></a></header>
  <main class="Topstory-container">
    <div class="Topstory-mainColumn">
      <div class="Card TopstoryItem"><div class="Feed">
        <div class="ContentItem AnswerItem" data-zop='{"authorName":"张三丰","itemId":987654321,"title":"某某某的私密回答","type":"answer","extra":"x"}' itemprop="answer" itemscope>
          <h2 class="ContentItem-title"><a href="/question/123456789/answer/987654321">某某某的私密回答</a></h2>
          <div itemprop="author" itemscope><meta itemprop="name" content="张三丰"><meta itemprop="url" content="https://www.zhihu.com/people/zhang-san-feng"></div>
          <meta itemprop="url" content="https://www.zhihu.com/question/123456789/answer/987654321">
          <meta itemprop="dateCreated" content="2023-11-14T22:13:20.000Z">
          <meta itemprop="upvoteCount" content="1234">
          <div class="RichContent is-collapsed"><div class="RichContent-inner">我的邮箱是 secret@mail.com，电话 13800001234。</div><button class="ContentItem-more" type="button">阅读全文</button></div>
          <div class="ContentItem-actions"><button class="Button VoteButton">赞同 1.2 万</button><button class="ContentItem-rightButton">收起</button></div>
          <script>window.secret = 1</script>
          <a href="javascript:alert(1)">x</a><a href="https://evil.example.com/?token=abc">外站</a>
          <input value="密码"><textarea>草稿</textarea><svg><path d="M0 0"/></svg>
        </div>
      </div></div>
    </div>
    <div class="css-1qyytj7"><div>右侧栏</div></div>
  </main>
</div>`
}

describe('文字脱敏', () => {
  test('汉字、字母、数字换成同样长度的占位符，标点不变，固定的界面文案保留', () => {
    expect(shape('回答 Abc-12.5，好！')).toBe('文文 xxx-00.0，文！')
    expect(scrubText('阅读全文')).toBe('阅读全文')
    expect(scrubText('赞同 1.2 万')).toBe('赞同 0.0 文')
    expect(scrubText('  收起  ')).toBe('  收起  ')
  })
})

describe('链接和 id 脱敏', () => {
  test('数字 id 保持数字，同一个 id 编号一致；用户标识换成 user-编号；查询参数去掉', () => {
    const scrub = new Scrubber()
    const a = scrub.url('https://www.zhihu.com/question/123/answer/456?utm_source=x#top')
    expect(a).toBe('https://www.zhihu.com/question/100001/answer/100002')
    expect(scrub.url('/question/123')).toBe('https://www.zhihu.com/question/100001')
    expect(scrub.url('https://zhuanlan.zhihu.com/p/456')).toBe('https://zhuanlan.zhihu.com/p/100002')
    expect(scrub.url('/people/zhang-san')).toBe('https://www.zhihu.com/people/user-1')
    expect(scrub.url('/people/zhang-san/answers')).toBe('https://www.zhihu.com/people/user-1/answers')
    expect(scrub.url('/people/li-si')).toBe('https://www.zhihu.com/people/user-2')
    expect(scrub.id('456')).toBe('100002')
    expect(scrub.id('abcdef0123')).toMatch(/^k\d+$/)
    expect(scrub.entityKey('answer:456')).toBe('answer:100002')
  })

  test('外站链接、javascript: 链接和无法解析的链接不保留，未知的路径段换成编号', () => {
    const scrub = new Scrubber()
    expect(scrub.url('https://evil.example.com/a?b=1')).toBe('https://external.invalid/')
    expect(scrub.url('javascript:alert(1)')).toBe('')
    expect(scrub.url('mailto:a@b.c')).toBe('')
    expect(scrub.url('#section')).toBe('#')
    expect(scrub.url('/some-private-slug/detail')).toBe('https://www.zhihu.com/seg-1/seg-2')
  })
})

describe('页面样本', () => {
  function capture() {
    document.body.innerHTML = privatePage()
    document.documentElement.setAttribute('data-theme', 'dark')
    return snapshotPage(document, {
      page: pageInfo('https://www.zhihu.com/?utm=secret'),
      version: '0.1.0',
      entities: ['answer:987654321', 'comment:55555'],
    })
  }

  test('样本里找不到任何原来的文字、标识、图片地址和外站链接', () => {
    const snapshot = capture()
    const text = stringifySnapshot(snapshot)
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret)
    for (const banned of [
      '13800001234',
      'evil.example',
      'track-1234',
      'color:red',
      'window.secret',
      '草稿',
      '密码',
      'alert',
    ]) {
      expect(text, banned).not.toContain(banned)
    }
    expect(auditSnapshot(document, snapshot)).toEqual([])
  })

  test('保留结构：标签、类名、itemprop、按钮文字，以及 id 之间的对应关系', () => {
    const snapshot = capture()
    const body = snapshot.html.join('')
    expect(body).toContain('class="Topstory-mainColumn"')
    expect(body).toContain('class="css-1qyytj7"')
    expect(body).toContain('itemprop="answer" itemscope')
    expect(body).toContain('>阅读全文</button>')
    expect(body).toContain('>收起</button>')
    expect(body).toContain('>赞同 0.0 文</button>')
    // data-zop、链接、实体键用的是同一个编号
    const zop = /data-zop="([^"]*)"/.exec(body)?.[1]?.replaceAll('&quot;', '"')
    expect(JSON.parse(zop ?? '{}')).toEqual({
      authorName: '用户1',
      itemId: 100001,
      title: '文文文文文文文文',
      type: 'answer',
    })
    expect(body).toContain('href="https://www.zhihu.com/question/100002/answer/100001"')
    expect(snapshot.entities).toEqual(['answer:100001', 'comment:100003'])
    expect(snapshot.url).toBe('https://www.zhihu.com/')
    // 日期只保留到天，数量保留
    expect(body).toContain('content="2023-11-14T00:00:00.000Z"')
    expect(body).toContain('itemprop="upvoteCount" content="1234"')
    expect(snapshot.root).toEqual({ 'data-theme': 'dark' })
    expect(snapshot.version).toBe('0.1.0')
  })

  test('标题、作者名、meta 内容里有空格、为空时也能通过检查', () => {
    document.body.innerHTML = `<div class="ContentItem" data-zop='{"authorName":"","itemId":"77","title":"普通问题 12 abc","type":"answer"}'><meta itemprop="name" content="张 三"><meta itemprop="headline" content=""></div>`
    const snapshot = snapshotPage(document, { page: pageInfo('https://www.zhihu.com/') })
    const body = snapshot.html.join('')
    expect(body).toContain('文文文文 00 xxx')
    expect(auditSnapshot(document, snapshot)).toEqual([])
  })

  test('html 分成多段只是为了好读：拼起来能被浏览器解析回来', () => {
    const snapshot = capture()
    expect(snapshot.html.length).toBeGreaterThan(20)
    const t = document.createElement('template')
    t.innerHTML = snapshot.html.join('')
    expect(t.content.querySelectorAll('.ContentItem').length).toBe(1)
    // img、input 只留下元素本身；脚本、svg 内部、输入框里的内容不保留
    expect(t.content.querySelector('script, path')).toBeNull()
    expect(t.content.querySelector('img')?.attributes.length).toBe(0)
    expect(t.content.querySelector('textarea')?.textContent).toBe('')
  })

  test('内容和评论超过上限时，连同外层卡片一起去掉', () => {
    document.body.innerHTML = `<div id="feed">${[1, 2, 3, 4, 5].map(n => feedCard('answer', String(n))).join('')}</div>`
    const snapshot = snapshotPage(document, { page: pageInfo('https://www.zhihu.com/'), maxContents: 3 })
    const t = document.createElement('template')
    t.innerHTML = snapshot.html.join('')
    expect(t.content.querySelectorAll('.ContentItem').length).toBe(3)
    expect(t.content.querySelectorAll('.TopstoryItem').length).toBe(3)
    expect(snapshot.expect.contents).toBe(3)

    document.body.innerHTML = `<div id="list">${[1, 2, 3].map(n => `<div data-id="${n}"><span>评论</span></div>`).join('')}</div>`
    const withComments = snapshotPage(document, {
      page: pageInfo('https://www.zhihu.com/'),
      entities: ['comment:1', 'comment:2', 'comment:3'],
      maxComments: 2,
    })
    expect(withComments.expect.comments).toBe(2)
    expect(withComments.html.join('').match(/data-id=/g)).toHaveLength(2)
  })

  test('记录内容往上每一层和它们兄弟的位置，以及两栏布局是否找得到', () => {
    document.body.innerHTML = `<div class="Topstory-container"><div class="main"><div class="ContentItem" data-zop='{"itemId":1,"type":"answer"}'></div></div><div class="side"></div></div>`
    const rects: Record<string, [number, number, number, number]> = {
      main: [0, 0, 600, 800],
      side: [620, 0, 300, 400],
      ContentItem: [0, 0, 600, 200],
      'Topstory-container': [0, 0, 920, 800],
    }
    for (const el of document.querySelectorAll<HTMLElement>('div')) {
      const r = rects[[...el.classList][0] ?? ''] ?? [0, 0, 0, 0]
      el.getBoundingClientRect = () =>
        ({ left: r[0], top: r[1], width: r[2], height: r[3], right: r[0] + r[2], bottom: r[1] + r[3] }) as DOMRect
    }
    const snapshot = snapshotPage(document, { page: pageInfo('https://www.zhihu.com/') })
    const body = snapshot.html.join('')
    expect(body).toContain('class="side" data-rect="620,0,300,400"')
    expect(body).toContain('class="ContentItem" data-zop=')
    expect(body).toContain('data-rect="0,0,600,200"')
    expect(snapshot.expect.columns).toBe(true)
    expect(snapshot.body['data-rect']).toMatch(/^-?\d+,-?\d+,\d+,\d+$/)
  })

  test('我们自己插入的界面、我们加的标记不进入样本', async () => {
    s = await setup()
    s.root.append(html(feedCard('answer', '1234')))
    await flush()
    const snapshot = snapshotPage(document, { page: pageInfo('https://www.zhihu.com/') })
    const body = snapshot.html.join('')
    expect(body).not.toContain('data-zb')
    expect(body).not.toContain('zb-root')
  })
})

describe('脱敏检查', () => {
  const base = () => {
    document.body.innerHTML = privatePage()
    return snapshotPage(document, { page: pageInfo('https://www.zhihu.com/') })
  }

  test('没有漏脱的样本没有问题', () => {
    expect(auditSnapshot(document, base())).toEqual([])
  })

  test('发现没脱敏的属性、链接、文字、id', () => {
    const snapshot = base()
    snapshot.html.push(
      '<img src="https://pic1.zhimg.com/a.jpg">',
      '<a href="https://www.zhihu.com/people/zhang?x=1">x</a>',
      '<a href="https://evil.example.com/">x</a>',
      '<p>真实的一段文字</p>',
      '<div data-id="abc-123" id="user12345" style="x"></div>',
      '<meta itemprop="name" content="张三丰">',
    )
    snapshot.url = 'https://www.zhihu.com/question/1?q=secret'
    const problems = auditSnapshot(document, snapshot).join('\n')
    expect(problems).toContain('不该保留的属性 src')
    expect(problems).toContain('不该保留的属性 style')
    expect(problems).toContain('链接没有脱敏')
    expect(problems).toContain('页面上的文字没有脱敏')
    expect(problems).toContain('data-id 没有编号')
    expect(problems).toContain('id 可能含有内容标识')
    expect(problems).toContain('content 没有脱敏')
    expect(problems).toContain('网址没有脱敏')
  })

  test('适配层的 snapshot() 输出通过检查的样本；没通过检查时报错而不是输出', async () => {
    s = await setup()
    s.root.append(html(feedCard('answer', '1234', { title: '一个很私密的标题', author: '某用户' })))
    await flush()
    const text = s.adapter.snapshot('0.1.0')
    const parsed = JSON.parse(text)
    expect(parsed.format).toBe(1)
    expect(text).not.toContain('一个很私密的标题')
    expect(text).not.toContain('某用户')
    expect(parsed.expect.contents).toBe(1)
  })
})
