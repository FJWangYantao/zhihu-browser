// 设置页的"数据包"：导入（先预览会改动哪些设置）和导出。格式见插件 API 文档第 16 节。

import { createDataPack, type DataPack, type ImportPreview, parseDataPack, previewDataPack } from '@zhihu-browser/core'
import type { PluginMeta, SettingSpec } from '@zhihu-browser/sdk'
import { useState } from 'preact/hooks'
import { SETTINGS_PREFIX, type StorageApi } from '../../src/storage'
import { Card } from './components'

/** 把插件当前的设置导出成数据包文件（浏览器下载） */
export function exportPack(meta: PluginMeta, values: Record<string, unknown>, doc: Document = document): DataPack {
  const pack = createDataPack(meta, values, { name: `${meta.name}的设置` })
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: 'application/json' }))
  const a = doc.createElement('a')
  a.href = url
  a.download = `zhihu-browser-${meta.id}.json`
  doc.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return pack
}

const MAX_SHOWN = 10

/** 设置值的显示文字 */
function show(spec: SettingSpec | undefined, value: unknown): string {
  if (spec?.type === 'boolean') return value ? '开' : '关'
  if (spec?.type === 'select') return spec.options[String(value)] ?? String(value)
  if (Array.isArray(value)) return value.length ? value.join('、') : '（空）'
  return String(value ?? '') || '（空）'
}

function listText(items: string[]): string {
  const shown = items.slice(0, MAX_SHOWN).join('、')
  return items.length > MAX_SHOWN ? `${shown} 等 ${items.length} 项` : shown
}

type Result = { pack: DataPack; meta: PluginMeta; preview: ImportPreview } | { error: string[] }

export function PackImport(props: {
  api: StorageApi
  plugins: readonly { meta: PluginMeta }[]
  settings: Record<string, Record<string, unknown>>
  onSaved: (message?: string) => void
}) {
  const [result, setResult] = useState<Result>()

  async function onFile(file: File) {
    const { pack, problems } = parseDataPack(await file.text())
    if (!pack) {
      setResult({ error: problems })
      return
    }
    const meta = props.plugins.find(p => p.meta.id === pack.plugin)?.meta
    if (!meta) {
      setResult({ error: [`这个数据包是给插件"${pack.plugin}"的，扩展里没有这个插件`] })
      return
    }
    setResult({ pack, meta, preview: previewDataPack(pack, meta, props.settings[meta.id] ?? {}) })
  }

  async function apply(meta: PluginMeta, pack: DataPack, preview: ImportPreview) {
    await props.api.local.set({ [SETTINGS_PREFIX + meta.id]: preview.next })
    setResult(undefined)
    props.onSaved(`已导入"${pack.name}"`)
  }

  return (
    <Card
      title="数据包"
      description="数据包是一份插件设置，用来分享屏蔽列表等配置，不含代码。导入时，列表类的设置会合并，其他设置会被覆盖；导入之前可以先看看会改动哪些设置。导出按钮在每个插件的设置下面。"
    >
      <div class="fields">
        <label class="file-button">
          选择数据包文件…
          <input
            type="file"
            accept=".json,application/json"
            onChange={e => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (file) void onFile(file)
            }}
          />
        </label>

        {result && 'error' in result && (
          <div class="pack-preview error" role="alert">
            <p>无法导入这个文件：</p>
            <ul>
              {result.error.map(problem => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}

        {result && 'preview' in result && (
          <section class="pack-preview" aria-label="导入预览">
            <h3>{result.pack.name}</h3>
            {result.pack.description && <p>{result.pack.description}</p>}
            <p class="description">
              导入到：{result.meta.name}
              {result.pack.author && ` · 作者：${result.pack.author}`}
            </p>
            {result.preview.changes.length ? (
              <ul class="changes">
                {result.preview.changes.map(c => (
                  <li key={c.key}>
                    <strong>{c.label}</strong>：
                    {c.mode === 'merge'
                      ? `新增 ${c.added?.length ?? 0} 项：${listText(c.added ?? [])}`
                      : `${show(result.meta.settings?.[c.key], c.before)} → ${show(result.meta.settings?.[c.key], c.after)}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p>导入后不会改变任何设置。</p>
            )}
            {result.preview.problems.length > 0 && (
              <>
                <p class="description">以下内容会被忽略：</p>
                <ul class="problems">
                  {result.preview.problems.map(problem => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </>
            )}
            <div class="actions">
              <button
                type="button"
                class="primary"
                disabled={!result.preview.changes.length}
                onClick={() => void apply(result.meta, result.pack, result.preview)}
              >
                导入
              </button>
              <button type="button" onClick={() => setResult(undefined)}>
                取消
              </button>
            </div>
          </section>
        )}
      </div>
    </Card>
  )
}
