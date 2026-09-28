// zhihu-browser 核心界面：和知乎无关，只依赖宿主（core）和浏览器 DOM。
export { connectHostUI, DEFAULT_PALETTE_KEYS, type HostUI, type HostUIOptions } from './host-ui'
export { isEditableEvent, isOwnUIEvent, listenKeys, strokeOf } from './keyboard'
export {
  createPageUI,
  injectStyle,
  type Modal,
  type ModalOptions,
  type PageUI,
  type PageUIOptions,
} from './page-ui'
export { filterItems, openPalette, type PaletteItem, type PaletteOptions } from './palette'
export { openDiagnosePanel, openPluginPanel, openShortcutHelp, sourceName } from './panels'
