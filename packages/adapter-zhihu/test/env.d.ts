// Vite / Vitest 的 ?raw 导入：把文件内容当作字符串
declare module '*?raw' {
  const content: string
  export default content
}
