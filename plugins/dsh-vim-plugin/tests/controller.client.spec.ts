/**
 * Controller spec: the enabled gate, mode publication, op application order,
 * and the reset on disable — against a recording face that mirrors the real
 * editing-face semantics.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ComposerEditFace } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { VimController } from '../src/client/controller.ts'

/** A face over a plain string, recording every verb call in order. */
function makeFace(initial: string, caret: number): { face: ComposerEditFace; calls: string[] } {
  const state = { text: initial, caret }
  const calls: string[] = []
  const face: ComposerEditFace = {
    text: () => state.text,
    caret: () => state.caret,
    selection: () => null,
    moveTo: (to) => {
      state.caret = to
      calls.push(`move:${to}`)
      return true
    },
    selectRange: (start, end) => {
      calls.push(`select:${start}-${end}`)
      return true
    },
    replaceRange: (start, end, text) => {
      state.text = state.text.slice(0, start) + text + state.text.slice(end)
      calls.push(`replace:${start}-${end}`)
      return true
    },
    insertBreak: (at) => {
      state.text = state.text.slice(0, at) + '\n' + state.text.slice(at)
      state.caret = at + 1
      calls.push(`break:${at}`)
      return true
    },
    undo: () => { calls.push('undo') },
  }
  return { face, calls }
}

/** A minimal KeyboardEvent stand-in (the controller reads only these fields). */
function keyEvent(key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods } as KeyboardEvent
}

describe('VimController', () => {
  it('starts disabled: keys pass and nothing is consulted', () => {
    const controller = new VimController(false)
    const { face, calls } = makeFace('abc', 1)
    expect(controller.keydown(face, keyEvent('Escape'))).toBe(false)
    expect(calls).toHaveLength(0)
    expect(controller.mode.getSnapshot()).toBe('insert')
  })

  it('enable, Escape to NORMAL, and x edit through the face in op order', () => {
    const controller = new VimController(false)
    controller.setEnabled(true)
    const { face, calls } = makeFace('abc', 1)
    expect(controller.keydown(face, keyEvent('Escape'))).toBe(true)
    expect(controller.mode.getSnapshot()).toBe('normal')
    expect(controller.keydown(face, keyEvent('x'))).toBe(true)
    expect(face.text()).toBe('bc')
    // Escape backs the caret to BOL; x then replaces [0,1) and re-lands the caret.
    expect(calls).toEqual(['move:0', 'replace:0-1', 'move:0'])
  })

  it('insert-mode typing passes; the caret read falls back to the selection end', () => {
    const controller = new VimController(true)
    const base = makeFace('abc', 0)
    const withSelection: ComposerEditFace = {
      ...base.face,
      selection: () => ({ start: 0, end: 2 }),
      caret: () => null,
    }
    expect(controller.mode.getSnapshot()).toBe('insert')
    expect(controller.keydown(withSelection, keyEvent('h'))).toBe(false)
    // Escape in normal-bound terms folds against the selection focus end.
    expect(controller.keydown(withSelection, keyEvent('Escape'))).toBe(true)
    expect(controller.mode.getSnapshot()).toBe('normal')
  })

  it('visual mode publishes through the mode store and edits through the face', () => {
    const controller = new VimController(true)
    const { face, calls } = makeFace('abc', 1)
    controller.keydown(face, keyEvent('Escape'))
    expect(controller.keydown(face, keyEvent('v'))).toBe(true)
    expect(controller.mode.getSnapshot()).toBe('visual')
    expect(calls).toContain('select:0-1')
    expect(controller.keydown(face, keyEvent('e'))).toBe(true)
    expect(calls).toContain('select:0-3')
    expect(controller.keydown(face, keyEvent('d'))).toBe(true)
    expect(controller.mode.getSnapshot()).toBe('normal')
    expect(face.text()).toBe('')
    expect(calls).toContain('replace:0-3')
  })

  it('applies break and undo operations through the face', () => {
    const controller = new VimController(true)
    const { face, calls } = makeFace('abc', 1)
    controller.keydown(face, keyEvent('Escape'))
    expect(controller.keydown(face, keyEvent('o'))).toBe(true)
    expect(calls).toContain('break:3')
    expect(controller.keydown(face, keyEvent('Escape'))).toBe(true)
    expect(controller.keydown(face, keyEvent('u'))).toBe(true)
    expect(calls).toContain('undo')
  })

  it('a null caret with no selection folds against the document end', () => {
    const controller = new VimController(true)
    const base = makeFace('abc', 0)
    const bare: ComposerEditFace = { ...base.face, caret: () => null }
    // Escape at the document end backs the caret off its last character.
    expect(controller.keydown(bare, keyEvent('Escape'))).toBe(true)
    expect(base.calls).toContain('move:2')
  })

  it('disable resets the machine and republishes insert', () => {
    const controller = new VimController(false)
    controller.setEnabled(true)
    const { face } = makeFace('abc', 1)
    controller.keydown(face, keyEvent('Escape'))
    expect(controller.mode.getSnapshot()).toBe('normal')
    controller.setEnabled(false)
    expect(controller.mode.getSnapshot()).toBe('insert')
    expect(controller.keydown(face, keyEvent('x'))).toBe(false)
    controller.toggle()
    expect(controller.enabled.getSnapshot()).toBe(true)
    expect(controller.mode.getSnapshot()).toBe('insert')
  })

  it('unidentified keys (IME residue) always pass', () => {
    const controller = new VimController(true)
    const { face, calls } = makeFace('abc', 1)
    expect(controller.keydown(face, keyEvent('Unidentified'))).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('the toggle callback flips the persisted store', () => {
    const controller = new VimController(false)
    const spy = vi.fn()
    controller.enabled.subscribe(spy)
    controller.toggle()
    expect(spy).toHaveBeenCalled()
    expect(controller.enabled.getSnapshot()).toBe(true)
  })
})
