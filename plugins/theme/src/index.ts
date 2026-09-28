// 官方插件"主题"：配色（浅色 / 暗色 / 跟随系统）、正文字体、字号、行高、主栏宽度、隐藏右侧栏。
//
// 只设置主题 token（插件 API 第 10.3 节），由适配层映射到知乎页面上；不直接写知乎的选择器，
// 所以知乎改版时不用改这个插件。所有设置都是"知乎默认"时不注入任何样式，页面保持原样。

import type { Dispose, PluginAPI, PluginMeta, SettingsOf } from '@zhihu-browser/sdk'

export const meta = {
  id: 'theme',
  name: '主题',
  version: '0.1.0',
  api: 1,
  description: '暗色、正文字体、字号、行高和主栏宽度，可以隐藏右侧栏',
  settings: {
    colorScheme: {
      type: 'select',
      label: '配色',
      default: 'zhihu',
      options: { zhihu: '跟随知乎', light: '浅色', dark: '暗色', system: '跟随系统' },
      description: '暗色使用知乎自带的暗色样式，并补上顶部导航栏',
    },
    fontFamily: {
      type: 'select',
      label: '正文字体',
      default: 'default',
      options: { default: '知乎默认', serif: '宋体', kai: '楷体', custom: '自定义' },
      description: '电脑上没有对应的字体时，浏览器会改用相近的字体',
    },
    customFont: {
      type: 'string',
      label: '自定义字体',
      default: '',
      placeholder: '如：LXGW WenKai, serif',
      description: '正文字体选"自定义"时使用，写法同 CSS 的 font-family，多个字体用逗号隔开',
    },
    fontSize: {
      type: 'select',
      label: '正文字号',
      default: 'default',
      options: {
        default: '知乎默认',
        '14px': '14 px',
        '16px': '16 px',
        '17px': '17 px',
        '18px': '18 px',
        '20px': '20 px',
      },
    },
    lineHeight: {
      type: 'select',
      label: '正文行高',
      default: 'default',
      options: { default: '知乎默认', '1.6': '紧凑', '1.8': '适中', '2.0': '宽松' },
    },
    contentWidth: {
      type: 'select',
      label: '主栏宽度',
      default: 'default',
      options: { default: '知乎默认', '800px': '800 px', '960px': '960 px', '1100px': '1100 px', '1280px': '1280 px' },
      description: '宽屏阅读；窗口不够宽时自动缩小',
    },
    hideSidebar: { type: 'boolean', label: '隐藏右侧栏', default: false },
  },
} satisfies PluginMeta

export type ThemeSettings = SettingsOf<typeof meta>

const FONTS: Record<string, string> = {
  serif: '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", STSong, SimSun, serif',
  kai: '"LXGW WenKai", "Kaiti SC", STKaiti, KaiTi, serif',
}

/** 自定义字体：只接受字体名称里常见的字符，引号要成对，避免写进别的 CSS */
export function safeFontFamily(value: string): string | undefined {
  const font = value.trim()
  if (!font || font.length > 200 || !/^[\p{L}\p{N}\s,'"_.-]+$/u.test(font)) return undefined
  const count = (quote: string) => font.split(quote).length - 1
  return count('"') % 2 === 0 && count("'") % 2 === 0 ? font : undefined
}

/** 按设置生成样式；全部是默认值时返回空字符串 */
export function themeCss(s: ThemeSettings): string {
  const tokens: string[] = []
  if (s.colorScheme === 'light' || s.colorScheme === 'dark') tokens.push(`--zb-color-scheme: ${s.colorScheme};`)
  const font = s.fontFamily === 'custom' ? safeFontFamily(s.customFont) : FONTS[s.fontFamily]
  if (font) tokens.push(`--zb-font-family: ${font};`)
  if (s.fontSize !== 'default') tokens.push(`--zb-font-size: ${s.fontSize};`)
  if (s.lineHeight !== 'default') tokens.push(`--zb-line-height: ${s.lineHeight};`)
  if (s.contentWidth !== 'default') tokens.push(`--zb-content-width: ${s.contentWidth};`)
  if (s.hideSidebar) tokens.push('--zb-sidebar: none;')

  const blocks: string[] = []
  if (tokens.length) blocks.push(`:root {\n${tokens.map(t => `  ${t}`).join('\n')}\n}`)
  if (s.colorScheme === 'system') {
    blocks.push(
      ':root {\n  --zb-color-scheme: light;\n}',
      '@media (prefers-color-scheme: dark) {\n  :root {\n    --zb-color-scheme: dark;\n  }\n}',
    )
  }
  return blocks.join('\n')
}

export default function theme(z: PluginAPI<typeof meta>) {
  let css = ''
  let remove: Dispose | undefined

  function apply(): void {
    const s = z.settings
    const values: ThemeSettings = {
      colorScheme: s.get('colorScheme'),
      fontFamily: s.get('fontFamily'),
      customFont: s.get('customFont'),
      fontSize: s.get('fontSize'),
      lineHeight: s.get('lineHeight'),
      contentWidth: s.get('contentWidth'),
      hideSidebar: s.get('hideSidebar'),
    }
    if (values.fontFamily === 'custom' && values.customFont.trim() && !safeFontFamily(values.customFont)) {
      z.log.warn('自定义字体里有不支持的字符，已改用知乎默认的字体')
    }
    const next = themeCss(values)
    if (next === css) return
    remove?.()
    css = next
    remove = css ? z.addStyle(css) : undefined
  }

  apply()
  z.settings.onChange(apply)
}
