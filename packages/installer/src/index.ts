// 用户插件的安装器：转译、静态解析 meta、比较权限。不依赖浏览器 API。
export { type CompiledPlugin, CompileError, compilePlugin, MAX_SOURCE_BYTES } from './compile'
export { evaluateLiteral, LiteralError } from './literal'
export { compareVersions, diffPermissions, hostPermissionPattern, networkHosts, type PermissionChange } from './review'
