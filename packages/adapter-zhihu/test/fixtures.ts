// 测试用的知乎数据。结构取自 M0 探针记录的接口结构（docs/spike-report.md），数值都是编造的。

type Obj = Record<string, unknown>

export const T0 = 1_700_000_000 // 秒

export function author(n = 1, extra: Obj = {}): Obj {
  return {
    id: `a${n}b2c3d4`,
    url_token: `user-${n}`,
    name: `用户${n}`,
    headline: '一句话介绍',
    avatar_url: `https://pic.example.com/avatar-${n}.jpg`,
    is_org: false,
    is_followed: false,
    is_following: false,
    gender: 1,
    type: 'people',
    user_type: 'people',
    url: `https://api.zhihu.com/people/a${n}b2c3d4`,
    badge: [],
    ...extra,
  }
}

export function apiQuestion(id = '2001', extra: Obj = {}): Obj {
  return {
    id,
    type: 'question',
    title: '一个问题',
    url: `https://api.zhihu.com/questions/${id}`,
    created: T0 - 86_400,
    updated_time: T0 - 3600,
    answer_count: 42,
    follower_count: 1000,
    comment_count: 2,
    detail: '<p>问题描述</p>',
    excerpt: '问题描述',
    question_type: 'normal',
    author: author(9),
    ...extra,
  }
}

export function apiAnswer(id = '1001', extra: Obj = {}): Obj {
  return {
    id,
    type: 'answer',
    answer_type: 'normal',
    url: `https://api.zhihu.com/answers/${id}`,
    author: author(1),
    question: { id: '2001', type: 'question', title: '一个问题', url: 'https://api.zhihu.com/questions/2001' },
    content: '<p>第一段</p><p>第二段 &amp; 更多</p>',
    excerpt: '第一段 第二段 &amp; 更多',
    created_time: T0,
    updated_time: T0 + 600,
    voteup_count: 12,
    comment_count: 3,
    thanks_count: 1,
    is_copyable: true,
    relationship: { voting: 0, is_thanked: false, is_nothelp: false },
    ...extra,
  }
}

export function apiArticle(id = '4001', extra: Obj = {}): Obj {
  return {
    id,
    type: 'article',
    title: '一篇文章',
    url: `https://api.zhihu.com/articles/${id}`,
    author: author(2),
    content: '<p>文章正文</p>',
    excerpt: '文章正文',
    created: T0,
    updated: T0 + 60,
    voteup_count: 7,
    comment_count: 0,
    ...extra,
  }
}

export function apiVideo(id = '5001', extra: Obj = {}): Obj {
  return {
    id,
    type: 'zvideo',
    title: '一个视频',
    description: '视频简介',
    author: author(4),
    published_at: T0,
    voteup_count: 3,
    comment_count: 1,
    video: { duration: 61 },
    ...extra,
  }
}

export function apiPin(id = '6001', extra: Obj = {}): Obj {
  return {
    id,
    type: 'pin',
    excerpt_title: '',
    author: author(5),
    content: [
      { type: 'text', content: '想法<br>正文' },
      { type: 'image', url: 'https://pic.example.com/1.jpg' },
    ],
    created: T0,
    updated: T0,
    comment_count: 0,
    ...extra,
  }
}

/** 首页推荐 /api/v3/feed/topstory/recommend */
export function recommend(targets: Obj[]): Obj {
  return {
    data: targets.map((target, i) => ({
      id: `feed-${i}`,
      type: 'feed',
      verb: 'TOPIC_ACKNOWLEDGED_ANSWER',
      offset: i,
      brief: '{}',
      attached_info: 'CAES',
      action_card: false,
      created_time: T0,
      updated_time: T0,
      target,
    })),
    paging: {
      is_end: false,
      is_start: true,
      next: 'https://www.zhihu.com/api/v3/feed/topstory/recommend?page_number=2',
    },
    fresh_text: '推荐已更新',
  }
}

/** 关注 /api/v3/moments：普通条目、广告和分组 */
export function moments(): Obj {
  return {
    data: [
      {
        id: 'm-1',
        type: 'feed',
        verb: 'MEMBER_VOTEUP_ANSWER',
        action_text: '赞同了回答',
        actors: [author(7), author(8)],
        target: apiAnswer('1101'),
      },
      { id: 'm-2', type: 'feed_advert', ad: { brand: { type: 'brand', name: '某品牌' } }, ad_list: [] },
      {
        id: 'm-3',
        type: 'feed_group',
        group_text: '用户8 提了 2 个问题',
        list: [
          { id: 'm-3-1', type: 'feed', verb: 'MEMBER_ASK_QUESTION', target: apiQuestion('2101') },
          {
            id: 'm-3-2',
            type: 'feed',
            verb: 'MEMBER_ASK_QUESTION',
            target: apiQuestion('2102', { title: '另一个问题' }),
          },
        ],
      },
    ],
    paging: { is_end: false, next: 'https://www.zhihu.com/api/v3/moments?offset=3' },
  }
}

/** 问题页回答列表 /api/v4/questions/:id/feeds */
export function questionFeeds(answers: Obj[]): Obj {
  return {
    data: answers.map((target, i) => ({
      type: 'question_feed_card',
      target_type: 'answer',
      cursor: `cursor-${i}`,
      position: i,
      skip_count: false,
      is_jump_native: false,
      target,
    })),
    paging: { is_end: false, next: 'https://www.zhihu.com/api/v4/questions/2001/feeds?cursor=x', page: 1 },
    session: { id: 's1' },
  }
}

/** 热榜 /api/v3/feed/topstory/hot-lists/total：卡片结构 */
export function hotList(): Obj {
  return {
    data: [
      {
        id: '0_1700000000.1',
        type: 'hot_list_feed',
        card_id: 'Q_3001',
        style_type: '1',
        attached_info: '',
        card_label: { type: 'hot', icon: '' },
        feed_specific: { answer_count: 88 },
        target: {
          title_area: { text: '热点问题' },
          excerpt_area: { text: '热点问题的摘要' },
          image_area: { url: '' },
          metrics_area: { text: '1234 万热度' },
          label_area: { type: 'trend', trend: 1 },
          link: { url: 'https://www.zhihu.com/question/3001' },
        },
      },
      {
        id: '0_1700000000.2',
        type: 'hot_list_feed',
        card_id: 'Q_3002',
        target: {
          title_area: { text: '另一个热点' },
          excerpt_area: { text: '' },
          link: { url: 'https://www.zhihu.com/question/3002' },
        },
      },
    ],
    paging: { is_end: true },
  }
}

/** 搜索 /api/v4/search_v3 */
export function search(): Obj {
  return {
    data: [
      {
        type: 'search_result',
        index: 0,
        highlight: { title: '<em>关键词</em>相关问题', description: '' },
        object: apiAnswer('1201', {
          question: { id: '2201', type: 'question', name: '<em>关键词</em>相关问题', url: '' },
          excerpt: '含有<em>关键词</em>的摘要',
          is_zhi_plus_content: false,
        }),
      },
      {
        type: 'search_result',
        index: 1,
        highlight: { title: '专栏文章', description: '' },
        object: apiArticle('4201', { paid_info: { type: 'paid_column_content', content: '', has_purchased: false } }),
      },
      { type: 'zvideo', index: 2, object: apiVideo('5201') },
      { type: 'relevant_query', index: 3, query_list: [{ query: '相关搜索' }] },
    ],
    paging: { is_end: false, next: 'https://www.zhihu.com/api/v4/search_v3?offset=20' },
  }
}

export function apiComment(id: string, extra: Obj = {}): Obj {
  return {
    id,
    type: 'comment',
    content: '<p>一条评论</p>',
    author: author(6, { is_anonymous: false }),
    created_time: T0,
    like_count: 5,
    dislike_count: 0,
    child_comment_count: 0,
    child_comments: [],
    reply_comment_id: '0',
    reply_root_comment_id: '0',
    resource_type: 'article',
    is_author: false,
    hot: false,
    top: false,
    collapsed: false,
    comment_tag: [{ type: 'ip_info', text: 'IP 属地某地' }],
    ...extra,
  }
}

/** 一级评论 /api/v4/comment_v5/articles/:id/root_comment */
export function rootComments(comments: Obj[]): Obj {
  return {
    data: comments,
    paging: { is_end: false, is_start: true, next: '', previous: '', totals: comments.length },
    counts: { total_counts: comments.length },
    sorter: [{ type: 'score', text: '最热' }],
  }
}

/** 首屏数据 js-initialData（回答页） */
export function initialData(): Obj {
  return {
    initialState: {
      entities: {
        answers: {
          '1301': {
            id: '1301',
            type: 'answer',
            answerType: 'normal',
            url: 'https://www.zhihu.com/question/2301/answer/1301',
            author: {
              id: 'a3b2c3d4',
              urlToken: 'user-3',
              name: '用户3',
              headline: '介绍',
              avatarUrl: 'https://pic.example.com/avatar-3.jpg',
              isOrg: false,
              userType: 'people',
            },
            question: { id: '2301', type: 'question', title: '首屏的问题', created: T0, updatedTime: T0 },
            content: '<p>首屏回答正文</p>',
            excerpt: '首屏回答正文',
            createdTime: T0,
            updatedTime: T0 + 100,
            voteupCount: 20000,
            commentCount: 9,
          },
        },
        questions: {
          '2301': { id: '2301', type: 'question', title: '首屏的问题', answerCount: 5, followerCount: 50, created: T0 },
        },
        users: { me: { id: 'me', uid: 1, userType: 'people' } },
        articles: {},
      },
    },
    subAppName: 'main',
  }
}
