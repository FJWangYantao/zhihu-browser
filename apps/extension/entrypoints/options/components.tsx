// 设置页的通用组件：开关、插件卡片、按设置项定义生成的表单项。

import type { PluginMeta, SettingSpec } from '@zhihu-browser/sdk'
import type { ComponentChildren } from 'preact'

export function Switch(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label class="switch" title={props.label}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        checked={props.checked}
        onChange={e => props.onChange(e.currentTarget.checked)}
      />
      <span aria-hidden="true" />
    </label>
  )
}

export function Card(props: {
  title: ComponentChildren
  description?: string
  aside?: ComponentChildren
  children?: ComponentChildren
  class?: string
}) {
  return (
    <section class={['card', props.class].filter(Boolean).join(' ')}>
      <div class="card-header">
        <div>
          <h2>{props.title}</h2>
          {props.description && <p>{props.description}</p>}
        </div>
        {props.aside}
      </div>
      {props.children}
    </section>
  )
}

export function PluginCard(props: {
  meta: PluginMeta
  enabled: boolean
  values: Record<string, unknown>
  onToggle: (enabled: boolean) => void
  onChange: (key: string, value: unknown) => void
  onReset: () => void
  onExport: () => void
  /** 卡片底部的额外内容（用户插件的权限、源码、卸载） */
  footer?: ComponentChildren
}) {
  const { meta } = props
  const specs = Object.entries(meta.settings ?? {})
  return (
    <Card
      class={props.enabled ? undefined : 'disabled'}
      title={
        <>
          {meta.name} <span class="version">{meta.version}</span>
        </>
      }
      description={meta.description}
      aside={<Switch label={`启用${meta.name}`} checked={props.enabled} onChange={props.onToggle} />}
    >
      {specs.length > 0 && (
        <div class="fields">
          {specs.map(([key, spec]) => (
            <Field
              key={key}
              id={`${meta.id}-${key}`}
              spec={spec}
              value={props.values[key]}
              onChange={value => props.onChange(key, value)}
            />
          ))}
          <div class="actions">
            <button type="button" class="link" onClick={props.onReset}>
              恢复默认设置
            </button>
            <button type="button" class="link" onClick={props.onExport}>
              导出为数据包
            </button>
          </div>
        </div>
      )}
      {props.footer}
    </Card>
  )
}

/** 列表：每行一项，空行忽略 */
export const toList = (text: string) =>
  text
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

export function Field(props: { id: string; spec: SettingSpec; value: unknown; onChange: (value: unknown) => void }) {
  const { id, spec, value, onChange } = props
  const description = spec.description && <p class="description">{spec.description}</p>

  if (spec.type === 'boolean') {
    return (
      <div class="field checkbox">
        <input id={id} type="checkbox" checked={value === true} onChange={e => onChange(e.currentTarget.checked)} />
        <label for={id}>{spec.label}</label>
        {description}
      </div>
    )
  }

  let control: preact.JSX.Element
  switch (spec.type) {
    case 'number':
      control = (
        <input
          id={id}
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={String(value)}
          onChange={e => onChange(Number(e.currentTarget.value))}
        />
      )
      break
    case 'string':
      control = (
        <input
          id={id}
          type="text"
          placeholder={spec.placeholder}
          value={String(value ?? '')}
          onChange={e => onChange(e.currentTarget.value)}
        />
      )
      break
    case 'text':
      control = (
        <textarea id={id} rows={4} value={String(value ?? '')} onChange={e => onChange(e.currentTarget.value)} />
      )
      break
    case 'select':
      control = (
        <select id={id} value={String(value)} onChange={e => onChange(e.currentTarget.value)}>
          {Object.entries(spec.options).map(([optionValue, label]) => (
            <option key={optionValue} value={optionValue}>
              {label}
            </option>
          ))}
        </select>
      )
      break
    case 'list':
      control = (
        <textarea
          id={id}
          rows={Math.min(Math.max(Array.isArray(value) ? value.length + 1 : 3, 3), 12)}
          placeholder={`${spec.placeholder ?? ''}（每行一个）`}
          value={Array.isArray(value) ? value.join('\n') : ''}
          onChange={e => onChange(toList(e.currentTarget.value))}
        />
      )
      break
    case 'color':
      control = <input id={id} type="color" value={String(value)} onChange={e => onChange(e.currentTarget.value)} />
      break
  }
  return (
    <div class="field">
      <label for={id}>{spec.label}</label>
      {control}
      {description}
    </div>
  )
}
