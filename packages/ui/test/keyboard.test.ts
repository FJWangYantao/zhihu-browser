import { describe, expect, test, vi } from 'vitest'
import { isEditableEvent, isOwnUIEvent, listenKeys, strokeOf } from '../src/index'

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, composed: true, ...init })

describe('strokeOf', () => {
  test.each<[KeyboardEventInit, string | undefined]>([
    [{ key: 'j', code: 'KeyJ' }, 'j'],
    [{ key: 'J', code: 'KeyJ', shiftKey: true }, 'shift+j'],
    [{ key: '?', code: 'Slash', shiftKey: true }, '?'],
    [{ key: 'k', code: 'KeyK', ctrlKey: true }, 'ctrl+k'],
    [{ key: 'k', code: 'KeyK', metaKey: true }, 'meta+k'],
    [{ key: '˚', code: 'KeyK', altKey: true }, 'alt+k'],
    [{ key: 'Enter', code: 'Enter', ctrlKey: true, shiftKey: true }, 'ctrl+shift+enter'],
    [{ key: 'ArrowUp', code: 'ArrowUp' }, 'up'],
    [{ key: ' ', code: 'Space' }, 'space'],
    [{ key: 'Escape', code: 'Escape' }, 'escape'],
    [{ key: 'F5', code: 'F5' }, 'f5'],
    [{ key: '1', code: 'Digit1', shiftKey: true }, 'shift+1'],
    [{ key: 'Shift', code: 'ShiftLeft', shiftKey: true }, undefined],
    [{ key: 'Control', code: 'ControlLeft', ctrlKey: true }, undefined],
    [{ key: 'j', code: 'KeyJ', isComposing: true }, undefined],
  ])('%j → %s', (init, expected) => {
    expect(strokeOf(key(init))).toBe(expected)
  })
})

describe('isEditableEvent', () => {
  const eventOn = (el: HTMLElement) => {
    document.body.append(el)
    let seen: Event | undefined
    el.addEventListener('keydown', e => {
      seen = e
    })
    el.dispatchEvent(key({ key: 'j' }))
    el.remove()
    if (!seen) throw new Error('没有收到事件')
    return seen
  }
  const make = (html: string) => {
    const t = document.createElement('template')
    t.innerHTML = html
    return t.content.firstElementChild as HTMLElement
  }

  test.each([
    ['<input>', true],
    ['<input type="search">', true],
    ['<input type="checkbox">', false],
    ['<textarea></textarea>', true],
    ['<select></select>', true],
    ['<div contenteditable="true"></div>', true],
    ['<button>按钮</button>', false],
    ['<div></div>', false],
  ])('%s → %s', (html, expected) => {
    expect(isEditableEvent(eventOn(make(html)))).toBe(expected)
  })

  test('可编辑区域里面的元素', () => {
    const editor = make('<div contenteditable><p><span>字</span></p></div>')
    document.body.append(editor)
    const span = editor.querySelector('span') as HTMLElement
    let seen: Event | undefined
    span.addEventListener('keydown', e => {
      seen = e
    })
    span.dispatchEvent(key({ key: 'j' }))
    editor.remove()
    expect(seen && isEditableEvent(seen)).toBe(true)
  })
})

test('isOwnUIEvent：来自带 data-zb-ui 的元素，包括它的 Shadow DOM 里面', () => {
  const host = document.createElement('div')
  host.setAttribute('data-zb-ui', '')
  const inner = document.createElement('button')
  host.attachShadow({ mode: 'open' }).append(inner)
  document.body.append(host)
  const seen: Event[] = []
  document.addEventListener('keydown', e => seen.push(e), { once: true })
  inner.dispatchEvent(key({ key: 'j' }))
  expect(isOwnUIEvent(seen[0] as Event)).toBe(true)
  host.remove()
})

test('listenKeys：按键交给处理函数；用掉的按键不再往下传', () => {
  const strokes: string[] = []
  const off = listenKeys(document, stroke => {
    strokes.push(stroke)
    return stroke === 'j'
  })
  const after = vi.fn()
  document.body.addEventListener('keydown', after)
  const j = key({ key: 'j', cancelable: true })
  document.body.dispatchEvent(j)
  document.body.dispatchEvent(key({ key: 'x' }))
  const input = document.createElement('input')
  document.body.append(input)
  input.dispatchEvent(key({ key: 'j' }))
  expect(strokes).toEqual(['j', 'x'])
  expect(j.defaultPrevented).toBe(true)
  // j 被用掉了，页面上的监听只收到 x 和输入框里的 j
  expect(after).toHaveBeenCalledTimes(2)
  off()
  document.body.dispatchEvent(key({ key: 'j' }))
  expect(strokes).toEqual(['j', 'x'])
  document.body.removeEventListener('keydown', after)
  input.remove()
})

test('listenKeys：我们自己界面里的按键（如面板上的按钮）不交给快捷键', () => {
  const strokes: string[] = []
  const off = listenKeys(document, stroke => {
    strokes.push(stroke)
    return true
  })
  const host = document.createElement('div')
  host.setAttribute('data-zb-ui', '')
  const button = document.createElement('button')
  host.attachShadow({ mode: 'open' }).append(button)
  document.body.append(host)
  button.dispatchEvent(key({ key: 'j' }))
  expect(strokes).toEqual([])
  off()
  host.remove()
})
