/**
 * The pure vim machine: motions, counts, operators, registers, and mode
 * transitions, asserted through a fold-and-apply simulator that mirrors the
 * controller's op application (so specs read as user-visible editing).
 */
import { describe, expect, it } from 'vitest'
import {
  INITIAL_VIM_STATE, step, type VimKey, type VimMachineState, type VimOp,
} from '../src/client/vim/machine.ts'

/** Normalize a key description into a VimKey. */
function key(k: string, mods: Partial<VimKey> = {}): VimKey {
  return { key: k, ctrl: false, meta: false, alt: false, shift: false, ...mods }
}

/** One simulated editor: text + caret, advanced by the machine's ops. */
class Editor {
  text: string
  caret: number
  ops: VimOp[] = []

  constructor(text: string, caret: number) {
    this.text = text
    this.caret = caret
  }

  apply(ops: readonly VimOp[]): void {
    for (const op of ops) {
      this.ops.push(op)
      switch (op.type) {
        case 'move': this.caret = op.to; break
        case 'select': break
        case 'replace':
          this.text = this.text.slice(0, op.start) + op.text + this.text.slice(op.end)
          break
        case 'break':
          this.text = this.text.slice(0, op.at) + '\n' + this.text.slice(op.at)
          break
        case 'undo': break
      }
    }
  }
}

/** Run one key through the machine against the editor, applying any ops. */
function type(machine: VimMachineState, editor: Editor, k: VimKey): VimMachineState {
  const result = step(machine, {
    text: editor.text,
    caret: editor.caret,
    selection: null,
  }, k)
  editor.apply(result.ops)
  return result.state
}

/** Drive a NORMAL-mode session from an initial text/caret through a key sequence. */
function drive(text: string, caret: number, keys: readonly (VimKey | string)[]): {
  editor: Editor
  machine: VimMachineState
} {
  let machine = INITIAL_VIM_STATE
  // Enter NORMAL the way a user does: the initial Escape.
  machine = type(machine, new Editor(text, caret), key('Escape'))
  machine = { ...machine, mode: 'normal' }
  const editor = new Editor(text, caret)
  for (const k of keys) machine = type(machine, editor, typeof k === 'string' ? key(k) : k)
  return { editor, machine }
}

describe('insert mode pass-through', () => {
  it('passes ordinary typing through untouched', () => {
    const { editor } = drive('hello', 0, ['i', 'X', 'Y'])
    expect(editor.text).toBe('hello')
    expect(editor.ops).toHaveLength(0)
  })

  it('passes modified keys through in normal mode and consumes Escape back to insert', () => {
    const { editor, machine } = drive('hello', 2, ['i'])
    expect(machine.mode).toBe('insert')
    // Escape returns to normal and backs the caret off the sat-on character.
    const after = type(machine, editor, key('Escape'))
    expect(after.mode).toBe('normal')
    expect(editor.caret).toBe(1)
  })

  it('Escape at BOL keeps the caret in place', () => {
    const { machine, editor } = drive('hello', 0, ['i'])
    const after = type(machine, editor, key('Escape'))
    expect(editor.caret).toBe(0)
    expect(after.mode).toBe('normal')
  })
})

describe('normal-mode key routing', () => {
  it('consumes unmapped printables without typing', () => {
    const { editor } = drive('abc', 1, ['q'])
    expect(editor.text).toBe('abc')
    expect(editor.ops).toHaveLength(0)
  })

  it('passes modifier-only and browser-owned keys', () => {
    const untouched = drive('abc', 1, [key('Shift'), key('Tab'), key('c', { ctrl: true })])
    expect(untouched.editor.ops).toHaveLength(0)
  })
})

describe('motions', () => {
  it('moves h/l within the line and clamps at its edges', () => {
    const simple = drive('one two', 1, ['l', 'l'])
    expect(simple.editor.caret).toBe(3)
    const clamped = drive('one', 0, ['h', 'h'])
    expect(clamped.editor.caret).toBe(0)
    // The caret may rest on the line-end insertion cell (the composer's own
    // native posture — typing there appends), so l clamps there.
    const endClamped = drive('one', 2, ['l', 'l', 'l'])
    expect(endClamped.editor.caret).toBe(3)
  })

  it('moves w/b/e across word classes with counts', () => {
    const text = 'foo.bar baz'
    const w = drive(text, 0, ['w'])
    expect(w.editor.caret).toBe(3)
    const threeW = drive(text, 0, ['3', 'w'])
    expect(threeW.editor.caret).toBe(8)
    const b = drive(text, 8, ['b'])
    expect(b.editor.caret).toBe(4)
    const e = drive(text, 0, ['e'])
    expect(e.editor.caret).toBe(2)
  })

  it('moves 0, ^, and $ along the line', () => {
    const text = '  indented'
    const zero = drive(text, 5, ['0'])
    expect(zero.editor.caret).toBe(0)
    const caret = drive(text, 5, ['^'])
    expect(caret.editor.caret).toBe(2)
    const dollar = drive(text, 0, ['$'])
    expect(dollar.editor.caret).toBe(9)
  })

  it('moves j/k down and up preserving the wanted column across short lines', () => {
    const text = 'longline1\nab\nlongline2'
    const down = drive(text, 6, ['j'])
    expect(down.editor.caret).toBe(12)
    const restore = drive(text, 6, ['j', 'j'])
    expect(restore.editor.caret).toBe(19)
    const up = drive(text, 6, ['j', 'k'])
    expect(up.editor.caret).toBe(6)
  })

  it('moves gg/G to the first non-blank of target lines', () => {
    const text = 'first\n  second\nthird'
    const gg = drive(text, 9, ['g', 'g'])
    expect(gg.editor.caret).toBe(0)
    const g = drive(text, 0, ['G'])
    expect(g.editor.caret).toBe(15)
    const line2 = drive(text, 0, ['2', 'G'])
    expect(line2.editor.caret).toBe(8)
  })

  it('finds f/F/t/T on the current line and repeats with ; and ,', () => {
    const text = 'a b c b a'
    const f = drive(text, 0, ['f', 'b'])
    expect(f.editor.caret).toBe(2)
    const semi = drive(text, 0, ['f', 'b', ';'])
    expect(semi.editor.caret).toBe(6)
    const comma = drive(text, 0, ['f', 'b', ';', ','])
    expect(comma.editor.caret).toBe(2)
    const t = drive(text, 0, ['t', 'b'])
    expect(t.editor.caret).toBe(1)
    const missing = drive(text, 0, ['f', 'z'])
    expect(missing.editor.caret).toBe(0)
  })
})

describe('counts', () => {
  it('accumulates multi-digit counts and treats 0 as a motion when no count is pending', () => {
    const count = drive('abcdef', 0, ['10', 'l'])
    expect(count.editor.caret).toBe(6)
    const zero = drive('abcdef', 3, ['0'])
    expect(zero.editor.caret).toBe(0)
  })
})

describe('single-key edits', () => {
  it('x deletes at the caret into the register; p pastes after', () => {
    const x = drive('abc', 1, ['x'])
    expect(x.editor.text).toBe('ac')
    expect(x.machine.register).toEqual({ text: 'b', linewise: false })
    const p = drive('abc', 1, ['x', 'p'])
    expect(p.editor.text).toBe('acb')
    expect(p.editor.caret).toBe(2)
  })

  it('x clamps at the line end (a deleted char never crosses lines)', () => {
    const clamped = drive('ab\ncd', 1, ['x', 'x', 'x'])
    expect(clamped.editor.text).toBe('a\ncd')
    expect(clamped.editor.caret).toBe(1)
  })

  it('s deletes the char under the caret and enters insert', () => {
    const s = drive('abc', 1, ['s'])
    expect(s.editor.text).toBe('ac')
    expect(s.machine.mode).toBe('insert')
    expect(s.editor.ops.some(op => op.type === 'replace' && op.text === '')).toBe(true)
  })

  it('D deletes to end of line; C enters insert after the same delete', () => {
    const d = drive('hello world', 5, ['D'])
    expect(d.editor.text).toBe('hello')
    expect(d.machine.register.text).toBe(' world')
    const c = drive('hello world', 5, ['C'])
    expect(c.editor.text).toBe('hello')
    expect(c.machine.mode).toBe('insert')
  })

  it('r replaces count characters with the given one', () => {
    const r = drive('abcdef', 1, ['r', 'Z'])
    expect(r.editor.text).toBe('aZcdef')
    expect(r.editor.caret).toBe(1)
  })

  it('o and O open lines and enter insert at the opened line', () => {
    const o = drive('one', 1, ['o'])
    expect(o.editor.text).toBe('one\n')
    expect(o.machine.mode).toBe('insert')
    expect(o.editor.caret).toBe(4)
    const bigO = drive('one', 1, ['O'])
    expect(bigO.editor.text).toBe('\none')
    expect(bigO.editor.caret).toBe(0)
  })

  it('a and A enter insert after the caret / at line end; I at first non-blank', () => {
    const a = drive('ab', 0, ['a'])
    expect(a.machine.mode).toBe('insert')
    expect(a.editor.caret).toBe(1)
    const bigA = drive('ab', 0, ['A'])
    expect(bigA.editor.caret).toBe(2)
    const bigI = drive('  ab', 4, ['I'])
    expect(bigI.editor.caret).toBe(2)
  })

  it('u emits an undo operation per count', () => {
    const u = drive('abc', 0, ['u'])
    expect(u.editor.ops).toEqual([{ type: 'undo' }])
    const three = drive('abc', 0, ['3', 'u'])
    expect(three.editor.ops.filter(op => op.type === 'undo')).toHaveLength(3)
  })
})

describe('operators', () => {
  it('dw deletes to the next word start and stores the charwise register', () => {
    const d = drive('foo bar', 0, ['d', 'w'])
    expect(d.editor.text).toBe('bar')
    expect(d.editor.caret).toBe(0)
    expect(d.machine.register).toEqual({ text: 'foo ', linewise: false })
  })

  it('de deletes to word end inclusively; d$ deletes to end of line', () => {
    const de = drive('foo bar', 0, ['d', 'e'])
    expect(de.editor.text).toBe(' bar')
    const dDollar = drive('foo bar', 1, ['d', '$'])
    expect(dDollar.editor.text).toBe('f')
  })

  it('cw changes through the word end (not its trailing whitespace)', () => {
    const cw = drive('foo bar', 0, ['c', 'w'])
    expect(cw.editor.text).toBe(' bar')
    expect(cw.machine.mode).toBe('insert')
  })

  it('dd removes the line with its terminator; on the last line no blank line remains', () => {
    const mid = drive('one\ntwo\nthree', 5, ['d', 'd'])
    expect(mid.editor.text).toBe('one\nthree')
    expect(mid.machine.register).toEqual({ text: 'two', linewise: true })
    const last = drive('one\ntwo', 5, ['d', 'd'])
    expect(last.editor.text).toBe('one')
    expect(last.editor.caret).toBe(0)
  })

  it('cc keeps one empty line and enters insert', () => {
    const cc = drive('one\ntwo\nthree', 5, ['c', 'c'])
    expect(cc.editor.text).toBe('one\n\nthree')
    expect(cc.machine.mode).toBe('insert')
    expect(cc.editor.caret).toBe(4)
  })

  it('dj removes two lines linewise; operator counts extend the range', () => {
    const dj = drive('one\ntwo\nthree', 0, ['d', 'j'])
    expect(dj.editor.text).toBe('three')
    const twoDd = drive('one\ntwo\nthree', 0, ['2', 'd', 'd'])
    expect(twoDd.editor.text).toBe('three')
  })

  it('yanks without touching the text and keeps the caret in place', () => {
    const y = drive('foo bar', 4, ['y', 'e'])
    expect(y.editor.text).toBe('foo bar')
    expect(y.editor.caret).toBe(4)
    expect(y.machine.register).toEqual({ text: 'bar', linewise: false })
  })

  it('yy yanks the whole line linewise and p opens it below', () => {
    const yy = drive('one\ntwo', 1, ['y', 'y'])
    expect(yy.machine.register).toEqual({ text: 'one', linewise: true })
    const p = drive('one\ntwo', 1, ['y', 'y', 'p'])
    expect(p.editor.text).toBe('one\none\ntwo')
    expect(p.editor.caret).toBe(4)
  })

  it('df, drives an operator through a find motion', () => {
    const d = drive('a,b,c', 0, ['d', 'f', ','])
    expect(d.editor.text).toBe('b,c')
  })

  it('operator + unmapped key cancels without editing', () => {
    const d = drive('abc', 0, ['d', 'z'])
    expect(d.editor.text).toBe('abc')
    expect(d.machine.pendingOperator).toBeNull()
  })

  it('dgg removes through the first line; dG removes through the last', () => {
    const dgg = drive('one\ntwo\nthree', 5, ['d', 'g', 'g'])
    expect(dgg.editor.text).toBe('three')
    const dg = drive('one\ntwo\nthree', 0, ['d', 'G'])
    expect(dg.editor.text).toBe('')
  })
})

describe('pasted register shapes', () => {
  it('dw across a line end captures the newline into the register', () => {
    const w = drive('ab\ncd', 1, ['d', 'w'])
    expect(w.editor.text).toBe('acd')
    expect(w.machine.register).toEqual({ text: 'b\n', linewise: false })
  })

  it('pasting that register emits break/replace primitives, never a literal newline', () => {
    const p = drive('ab\ncd', 1, ['d', 'w', 'p'])
    expect(p.editor.text).toBe('acb\nd')
    expect(p.editor.caret).toBe(3)
    expect(p.editor.ops.some(op => op.type === 'replace' && op.text.includes('\n'))).toBe(false)
    expect(p.editor.ops.filter(op => op.type === 'break')).toHaveLength(1)
  })
})

describe('visual mode entry and selection', () => {
  it('v selects the character under the caret; motions extend inclusively', () => {
    const v = drive('foo bar', 0, ['v'])
    expect(v.editor.ops).toEqual([{ type: 'select', start: 0, end: 1 }])
    expect(v.machine.visual).toEqual({ anchor: 0, caret: 0, linewise: false })
    const ve = drive('foo bar', 0, ['v', 'e'])
    expect(ve.machine.visual).toEqual({ anchor: 0, caret: 2, linewise: false })
    expect(ve.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 3 })
    const vll = drive('foo bar', 0, ['v', 'l', 'l'])
    expect(vll.machine.visual?.caret).toBe(2)
    expect(vll.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 3 })
  })

  it('backward motions extend over the anchor character', () => {
    const vb = drive('foo bar', 4, ['v', 'b'])
    expect(vb.machine.visual).toEqual({ anchor: 4, caret: 0, linewise: false })
    expect(vb.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 5 })
  })

  it('$ extends through the line end; counts and find motions apply', () => {
    const dollar = drive('foo bar', 0, ['v', '$'])
    expect(dollar.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 7 })
    const count = drive('foo bar baz', 0, ['v', '2', 'e'])
    expect(count.machine.visual?.caret).toBe(6)
    expect(count.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 7 })
    const find = drive('foo', 0, ['v', 'f', 'o'])
    expect(find.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 2 })
  })

  it('V selects whole lines and j extends linewise', () => {
    const bigV = drive('ab\ncd', 1, ['V'])
    expect(bigV.machine.visual).toEqual({ anchor: 1, caret: 1, linewise: true })
    expect(bigV.editor.ops).toEqual([{ type: 'select', start: 0, end: 2 }])
    const down = drive('one\ntwo', 0, ['V', 'j'])
    expect(down.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 7 })
  })

  it('v toggles to linewise and back; a repeat of the entry key exits', () => {
    const swap = drive('ab\ncd', 1, ['v', 'V'])
    expect(swap.machine.visual?.linewise).toBe(true)
    expect(swap.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 2 })
    const back = drive('ab\ncd', 1, ['v', 'V', 'v'])
    expect(back.machine.visual?.linewise).toBe(false)
    const exit = drive('abc', 1, ['v', 'l', 'v'])
    expect(exit.machine.visual).toBeNull()
    expect(exit.editor.caret).toBe(2)
    const exitV = drive('abc', 1, ['V', 'V'])
    expect(exitV.machine.visual).toBeNull()
  })

  it('Escape collapses the selection and returns to normal', () => {
    const esc = drive('abc', 0, ['v', 'l', 'Escape'])
    expect(esc.machine.visual).toBeNull()
    expect(esc.machine.mode).toBe('normal')
    expect(esc.editor.caret).toBe(1)
    expect(esc.editor.ops.at(-1)).toEqual({ type: 'move', to: 1 })
  })

  it('unmapped printables are consumed and the selection survives', () => {
    const unmapped = drive('abc', 1, ['v', 'q'])
    expect(unmapped.machine.visual).toEqual({ anchor: 1, caret: 1, linewise: false })
    expect(unmapped.editor.text).toBe('abc')
  })
})

describe('visual mode operators', () => {
  it('d/x delete the charwise selection into the register and land at its head', () => {
    const d = drive('foo bar', 0, ['v', 'e', 'd'])
    expect(d.editor.text).toBe(' bar')
    expect(d.editor.caret).toBe(0)
    expect(d.machine.register).toEqual({ text: 'foo', linewise: false })
    expect(d.machine.visual).toBeNull()
    expect(d.machine.mode).toBe('normal')
    const x = drive('foo bar', 0, ['v', 'e', 'x'])
    expect(x.editor.text).toBe(' bar')
    expect(x.machine.visual).toBeNull()
  })

  it('y yanks the selection and collapses the caret at its head', () => {
    const y = drive('foo bar', 0, ['v', 'e', 'y'])
    expect(y.editor.text).toBe('foo bar')
    expect(y.machine.register).toEqual({ text: 'foo', linewise: false })
    expect(y.machine.visual).toBeNull()
    expect(y.editor.ops.at(-1)).toEqual({ type: 'move', to: 0 })
  })

  it('c/s delete the selection and enter insert', () => {
    const c = drive('foo bar', 0, ['v', 'e', 'c'])
    expect(c.editor.text).toBe(' bar')
    expect(c.machine.mode).toBe('insert')
    expect(c.machine.visual).toBeNull()
    const s = drive('foo bar', 0, ['v', 'e', 's'])
    expect(s.machine.mode).toBe('insert')
  })

  it('V d removes the addressed lines linewise; D/Y/C force linewise over a charwise selection', () => {
    const bigD = drive('one\ntwo\nthree', 0, ['V', 'j', 'd'])
    expect(bigD.editor.text).toBe('three')
    expect(bigD.machine.register).toEqual({ text: 'one\ntwo', linewise: true })
    const d = drive('one\ntwo\nthree', 0, ['v', 'e', 'D'])
    expect(d.editor.text).toBe('two\nthree')
    expect(d.machine.register).toEqual({ text: 'one', linewise: true })
    const y = drive('one\ntwo', 0, ['v', 'l', 'Y'])
    expect(y.machine.register).toEqual({ text: 'one', linewise: true })
    expect(y.editor.text).toBe('one\ntwo')
    const c = drive('one\ntwo', 0, ['v', 'e', 'C'])
    expect(c.editor.text).toBe('\ntwo')
    expect(c.machine.mode).toBe('insert')
  })

  it('V y yanks the lines linewise and p pastes them below', () => {
    const vy = drive('one\ntwo', 1, ['V', 'y'])
    expect(vy.machine.register).toEqual({ text: 'one', linewise: true })
    const p = drive('one\ntwo', 1, ['V', 'y', 'p'])
    expect(p.editor.text).toBe('one\none\ntwo')
    expect(p.editor.caret).toBe(4)
  })
})

describe('motion and prefix edge arms', () => {
  it('^ on an empty line lands on its end cell', () => {
    const caret = drive('ab\n', 3, ['^'])
    expect(caret.editor.caret).toBe(3)
  })

  it('a backward find miss keeps the caret in place', () => {
    const miss = drive('abc', 1, ['F', 'z'])
    expect(miss.editor.caret).toBe(1)
  })

  it('T lands after a backward find and , inverts it into t', () => {
    const t = drive('ab a', 3, ['T', 'a', ','])
    expect(t.editor.caret).toBe(2)
  })

  it(', after F and t inverts through the remaining find kinds', () => {
    const afterF = drive('a b a', 4, ['F', 'a', ','])
    expect(afterF.editor.caret).toBe(4)
    const afterT = drive('ab cd', 0, ['t', 'd', ','])
    expect(afterT.editor.caret).toBe(3)
  })

  it('non-printable unmapped keys pass through visual mode too', () => {
    const pass = drive('abc', 1, ['v', 'Enter'])
    expect(pass.machine.visual).toEqual({ anchor: 1, caret: 1, linewise: false })
    expect(pass.editor.ops).toEqual([{ type: 'select', start: 1, end: 2 }])
  })

  it('r at the line end replaces nothing', () => {
    const r = drive('ab', 2, ['r', 'Z'])
    expect(r.editor.text).toBe('ab')
    expect(r.editor.caret).toBe(2)
  })

  it('a non-gg second key cancels the g wait and runs itself', () => {
    const cancel = drive('abc', 1, ['g', 'h'])
    expect(cancel.editor.caret).toBe(0)
  })

  it('counts continue through 0 and clamp at the line end', () => {
    const ten = drive('abcdef', 0, ['1', '0', 'l'])
    expect(ten.editor.caret).toBe(6)
  })

  it('operator + ; with no remembered find cancels the operator', () => {
    const d = drive('abc', 0, ['d', ';'])
    expect(d.editor.text).toBe('abc')
    expect(d.machine.pendingOperator).toBeNull()
  })

  it('non-printable unmapped keys pass through normal mode', () => {
    const pass = drive('abc', 0, ['Enter'])
    expect(pass.editor.ops).toHaveLength(0)
  })
})

describe('visual mode edge arms', () => {
  it('a non-printable key during a find wait exits visual and collapses', () => {
    const cancel = drive('abc', 0, ['v', 'f', 'Enter'])
    expect(cancel.machine.visual).toBeNull()
    expect(cancel.machine.mode).toBe('normal')
    expect(cancel.editor.ops.at(-1)).toEqual({ type: 'move', to: 0 })
  })

  it('vgg extends the selection to the first line; a stray second key still moves', () => {
    const gg = drive('one\ntwo', 5, ['v', 'g', 'g'])
    expect(gg.machine.visual?.caret).toBe(0)
    expect(gg.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 6 })
    const stray = drive('abc', 0, ['v', 'g', 'l'])
    expect(stray.machine.visual?.caret).toBe(1)
    expect(stray.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 2 })
  })

  it('counts continue through 0 in visual mode', () => {
    const ten = drive('abcdefghijkl', 0, ['v', '1', '0', 'l'])
    expect(ten.machine.visual?.caret).toBe(10)
    expect(ten.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 11 })
  })

  it('; repeats the remembered find inside visual; a bare ; is a no-op', () => {
    const repeat = drive('foo', 0, ['v', 'f', 'o', ';'])
    expect(repeat.editor.ops.at(-1)).toEqual({ type: 'select', start: 0, end: 3 })
    const bare = drive('foo', 1, ['v', ';'])
    expect(bare.machine.visual).toEqual({ anchor: 1, caret: 1, linewise: false })
    expect(bare.editor.ops).toEqual([{ type: 'select', start: 1, end: 2 }])
  })
})
