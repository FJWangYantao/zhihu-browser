// 需要交给扩展隔离环境处理的知乎接口。页面主环境只用这一个正则判断，所以单独放在这里，避免把其他代码打包进去。

/**
 * 内容相关的数据接口：信息流、回答列表、搜索、评论，以及单个回答、文章和用户主页等列表。
 * 其他接口（如 /api/v4/me、广告、埋点）原样放行，不经过适配层。
 * 知乎只有 https；也接受 http 是为了在本地模拟的知乎上做端到端测试。
 */
export const DATA_API =
  /^https?:\/\/(?:www|zhuanlan)\.zhihu\.com\/api\/(?:v3\/feed\/topstory\/(?:recommend|hot-lists?)\b|v3\/moments\b|v4\/questions\/\d+\/(?:feeds|answers)\b|v4\/search_v3\b|v4\/comment_v5\/|v4\/answers\/\d+(?:[?#]|$)|v4\/articles\/\d+(?:[?#]|$)|articles\/\d+\/recommendation\b|v4\/members\/[^/?#]+\/(?:answers|articles|pins|zvideos)\b|v4\/topics\/\d+\/feeds\b|v4\/collections\/\d+\/items\b)/
