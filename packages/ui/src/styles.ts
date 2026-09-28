// 界面层（Shadow DOM 里）的样式。颜色优先用主题 token（--zb-color-*），没有设置时用默认值；
// 知乎打开暗色时（<html data-theme="dark">），界面层的宿主元素会加上 dark 类。

export const ROOT_CSS = `
:host {
  all: initial;
  --ui-surface: var(--zb-color-surface, #fff);
  --ui-text: var(--zb-color-text, #121212);
  --ui-muted: var(--zb-color-text-secondary, #8590a6);
  --ui-border: var(--zb-color-border, #e5e5e5);
  --ui-accent: var(--zb-color-accent, #056de8);
  --ui-selected: rgba(5, 109, 232, 0.1);
  --ui-danger: #d03a3a;
  --ui-font: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
}
:host(.dark) {
  --ui-surface: var(--zb-color-surface, #1f1f1f);
  --ui-text: var(--zb-color-text, #e6e6e6);
  --ui-muted: var(--zb-color-text-secondary, #9a9aa0);
  --ui-border: var(--zb-color-border, #3a3a3a);
  --ui-accent: var(--zb-color-accent, #3a8ee6);
  --ui-selected: rgba(58, 142, 230, 0.2);
  --ui-danger: #ef6b6b;
}

.toolbar {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
}
.toasts {
  position: fixed; left: 50%; top: 72px; transform: translateX(-50%); z-index: 2147483600;
  display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none;
}
.toast {
  max-width: min(480px, calc(100vw - 32px)); padding: 10px 16px; border-radius: 8px;
  font: 14px/20px var(--ui-font); color: #fff; background: rgba(18, 18, 18, 0.88);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
.toast[data-tone="success"] { background: #0a8c55; }
.toast[data-tone="warn"] { background: #b86200; }
.toast[data-tone="error"] { background: #c33; }

.backdrop {
  position: fixed; inset: 0; z-index: 2147483500; background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center;
}
.backdrop.top { align-items: flex-start; padding-top: 12vh; }
.panel {
  box-sizing: border-box; max-height: 76vh; display: flex; flex-direction: column; overflow: hidden;
  border-radius: 12px; font: 14px/1.5 var(--ui-font); color: var(--ui-text); background: var(--ui-surface);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
}
.panel:focus { outline: none; }
.dialog { width: min(400px, calc(100vw - 32px)); padding: 24px; font-size: 15px; line-height: 24px; }
.message { white-space: pre-wrap; word-break: break-word; }
.buttons { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
button {
  font: inherit; font-size: 14px; padding: 6px 16px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--ui-border); background: transparent; color: inherit;
}
button.primary { border-color: var(--ui-accent); background: var(--ui-accent); color: #fff; }
button.link { padding: 0; border: 0; color: var(--ui-accent); }
button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
kbd {
  display: inline-block; min-width: 1.4em; padding: 0 6px; border-radius: 4px; text-align: center;
  font: 12px/20px var(--ui-font); color: var(--ui-muted); border: 1px solid var(--ui-border);
}

.palette { width: min(560px, calc(100vw - 32px)); }
.palette input {
  box-sizing: border-box; width: 100%; padding: 14px 16px; border: 0; border-bottom: 1px solid var(--ui-border);
  font: 16px/24px var(--ui-font); color: inherit; background: transparent; outline: none;
}
.palette input::placeholder { color: var(--ui-muted); }
.palette [role="listbox"] { margin: 0; padding: 6px; overflow-y: auto; list-style: none; }
.palette [role="option"] {
  display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 8px; cursor: pointer;
}
.palette [role="option"][aria-selected="true"] { background: var(--ui-selected); }
.palette .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette .source { font-size: 12px; color: var(--ui-muted); white-space: nowrap; }
.empty { padding: 16px; text-align: center; color: var(--ui-muted); }

.sheet { width: min(640px, calc(100vw - 32px)); }
.sheet header {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 16px 20px; border-bottom: 1px solid var(--ui-border);
}
.sheet h2 { margin: 0; font-size: 16px; }
.sheet .body { padding: 8px 20px 20px; overflow-y: auto; }
.sheet h3 { margin: 16px 0 6px; font-size: 13px; color: var(--ui-muted); font-weight: 600; }
.row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
  padding: 8px 0; border-bottom: 1px solid var(--ui-border);
}
.row:last-child { border-bottom: 0; }
.row .main { flex: 1; min-width: 0; }
.note { font-size: 12px; color: var(--ui-muted); }
.note.warn { color: var(--ui-danger); }
.state { font-size: 12px; padding: 0 8px; border-radius: 10px; line-height: 20px; white-space: nowrap; }
.state[data-state="active"] { color: #0a8c55; background: rgba(10, 140, 85, 0.12); }
.state[data-state="inactive"] { color: var(--ui-muted); background: rgba(133, 144, 166, 0.14); }
.state[data-state="failed"] { color: var(--ui-danger); background: rgba(208, 58, 58, 0.12); }
.logs {
  margin: 6px 0 0; padding: 8px 10px; max-height: 160px; overflow: auto; border-radius: 6px;
  font: 12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: rgba(133, 144, 166, 0.1);
  white-space: pre-wrap; word-break: break-word;
}
.logs [data-level="error"] { color: var(--ui-danger); }
.logs [data-level="warn"] { color: #b86200; }

.overlay {
  position: fixed; inset: 0; z-index: 2147483400; overflow: auto;
  background: var(--zb-color-bg, #fff);
}
`
