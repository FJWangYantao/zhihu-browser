// zhihu-browser 插件宿主。与知乎、DOM 和扩展环境无关，所需的能力由 HostServices 提供。
export { createHost, type Host } from './host'
export { createMemorySettingsBackend, createMemoryStorageBackend } from './memory'
export {
  checkSettingValue,
  defaultSettings,
  PluginLoadError,
  SUPPORTED_API_VERSIONS,
  sanitizeSettings,
  validateMeta,
} from './meta'
export { BUDGET_MS } from './monitor'
export {
  createDataPack,
  type DataPack,
  type ImportChange,
  type ImportPreview,
  parseDataPack,
  previewDataPack,
} from './packs'
export { checkFetchUrl, hostMatches, isZhihuHost, validPermission } from './permissions'
export { formatShortcut, HOST_OWNER, normalizeShortcut, resolveMod } from './shortcuts'
export type * from './types'
