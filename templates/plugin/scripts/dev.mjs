// 开发模式：保存文件就重新打包，并通过本机的一个小服务器提供 dist/plugin.js。
// 在扩展的设置页"安装用户插件"里，把链接填成 http://127.0.0.1:5177/plugin.js，
// 安装之后在"开发模式"里监听这个链接：以后每次保存，已经打开的知乎页面里的插件都会自动热重载。

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { context } from 'esbuild'

const PORT = Number(process.env.PORT ?? 5177)

const ctx = await context({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/plugin.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
})
await ctx.watch()

createServer(async (req, res) => {
  // 设置页在扩展的页面里，跨域读取这个链接需要允许
  const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
  if (req.url?.split('?')[0] !== '/plugin.js') {
    res.writeHead(404, headers)
    return res.end('只有 /plugin.js')
  }
  try {
    res.writeHead(200, { ...headers, 'content-type': 'text/javascript; charset=utf-8' })
    res.end(await readFile('dist/plugin.js'))
  } catch {
    res.writeHead(503, headers)
    res.end('还没有打包好，稍等一下')
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n插件地址：http://127.0.0.1:${PORT}/plugin.js`)
})
