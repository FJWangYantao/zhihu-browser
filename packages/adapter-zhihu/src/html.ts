const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(entity: string): string {
  if (entity.startsWith('#x') || entity.startsWith('#X'))
    return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
  if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
  return NAMED[entity.toLowerCase()] ?? `&${entity};`
}

/** 把知乎返回的 HTML 片段转成纯文本（不依赖 DOM，页面主环境和测试里都能用）。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(?:br|p|div|li|h\d|blockquote|figure|tr)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, e: string) => decode(e))
    .replace(/\s+/g, ' ')
    .trim()
}

/** 字数：非空白字符的个数。 */
export function wordCount(text: string): number {
  return text.replace(/\s+/g, '').length
}
