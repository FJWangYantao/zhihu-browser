// 把 src/index.ts 打成一个单文件插件：dist/plugin.js。
// 不压缩：用户安装前会看到完整源码，官方插件索引也不收录混淆过的代码。
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/plugin.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: false,
  legalComments: 'none',
})
console.log('已生成 dist/plugin.js')
