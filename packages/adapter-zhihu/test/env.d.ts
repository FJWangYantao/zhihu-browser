// Vite / Vitest 的 ?raw 导入：把文件内容当作字符串
declare module '*?raw' {
  const content: string
  export default content
}

// happy-dom 的窗口：测试里用它切换页面网址（首页、专栏文章在不同的域名上）
interface Window {
  happyDOM?: { setURL(url: string): void }
}
