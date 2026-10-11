/**
 * The pure vim machine: modes, counts, registers, motions, operators, and
 * visual selections over a flat detect-projection document (newline-separated
 * lines, chip = one U+FFFC). Zero React/DOM/cordis — `step` folds one key
 * event plus the document snapshot into primitive editor operations the
 * controller applies through the composer's editing face. The machine
 * simulates its own edits, so every operation it emits is already expressed
 * in the coordinates of the document state its predecessors produced.
 */

/** Editor operations the controller applies through a ComposerEditFace. */
export type VimOp =
  | { readonly type: 'move'; readonly to: number }
  | { readonly type: 'select'; readonly start: number; readonly end: number }
  | { readonly type: 'replace'; readonly start: number; readonly end: number; readonly text: string }
  | { readonly type: 'break'; readonly at: number }
  | { readonly type: 'undo' }

/** The composer document snapshot a key event is folded against. */
export interface VimDoc {
  /** Detect-projection text (chip = U+FFFC, newline = line boundary). */
  readonly text: string
  /** Collapsed caret offset (selection focus end when a range is active). */
  readonly caret: number
  /** Live range selection, when the user dragged one. */
  readonly selection: { readonly start: number; readonly end: number } | null
  /**
   * Display-row start offsets for soft-wrapped rendering (0, then every wrap
   * point and every logical line start), measured by the controller when a
   * `g`-prefixed motion needs it; null/absent degrades `gj`/`gk` to `j`/`k`.
   */
  readonly vlines?: readonly number[] | null
}

/** Normalized key event description. */
export interface VimKey {
  readonly key: string
  readonly ctrl: boolean
  readonly meta: boolean
  readonly alt: boolean
  readonly shift: boolean
}

/** The single unnamed register (charwise or linewise). */
export interface VimRegister {
  readonly text: string
  readonly linewise: boolean
}

/** One-character find motions waiting for their target (`f`/`F`/`t`/`T`). */
export type FindKind = 'f' | 'F' | 't' | 'T'

/**
 * An active visual selection: the offset the selection grew from (`anchor`),
 * the moving end motions drive (`caret`, the machine's own caret while the
 * selection is live — the composer selection shows the derived span), and
 * whether the selection addresses whole lines.
 */
export interface VisualState {
  readonly anchor: number
  readonly caret: number
  readonly linewise: boolean
}

/** Mutable machine state between key events. */
export interface VimMachineState {
  readonly mode: 'insert' | 'normal'
  /** Active visual selection (null outside visual mode). */
  readonly visual: VisualState | null
  /** Operator awaiting its motion or its doubling (`dd`). */
  readonly pendingOperator: 'd' | 'c' | 'y' | null
  /** Pending count prefix (null = none; resolved to 1 at use). */
  readonly count: number | null
  /** `g` pressed, awaiting the second `g` of `gg`. */
  readonly pendingG: boolean
  /** Find motion awaiting its target character. */
  readonly pendingFind: FindKind | null
  /** `r` pressed, awaiting its replacement character. */
  readonly pendingReplace: boolean
  /** Last completed find motion (`;`/`,` repeat it). */
  readonly lastFind: { readonly kind: FindKind; readonly char: string } | null
  /** Yank/delete register. */
  readonly register: VimRegister
  /** Remembered column for vertical motions (null = take the current column). */
  readonly wantColumn: number | null
}

/** One `step` outcome: the next state, whether the key was consumed, and the operations to apply in order. */
export interface VimStep {
  readonly state: VimMachineState
  readonly consume: boolean
  readonly ops: readonly VimOp[]
}

/** Fresh machine state: insert mode (the composer's native posture), empty everything. */
export const INITIAL_VIM_STATE: VimMachineState = {
  mode: 'insert',
  visual: null,
  pendingOperator: null,
  count: null,
  pendingG: false,
  pendingFind: null,
  pendingReplace: false,
  lastFind: null,
  register: { text: '', linewise: false },
  wantColumn: null,
}

/** The empty-register constant. */
/** Word character class (letters, numbers, underscore). */
const WORD_RE = /[\p{L}\p{N}_]/u

/** The detect-projection chip placeholder is a punctuation-class atom. */
const CHIP = '\uFFFC'

/** Classification of one character for word motions. */
type CharClass = 'blank' | 'word' | 'punct'

function classOf(text: string, at: number): CharClass {
  const ch = text[at] ?? ''
  if (ch === '' || /\s/u.test(ch)) return 'blank'
  if (ch === CHIP) return 'punct'
  return WORD_RE.test(ch) ? 'word' : 'punct'
}

/** Ordered line-start offsets of a document (starts[0] === 0). */
function lineStarts(text: string): readonly number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/** The line index one offset lives on. */
function lineOf(starts: readonly number[], at: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((starts[mid] ?? 0) <= at) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** One-line [start, end) window; end excludes the terminating newline. */
function lineSpan(text: string, starts: readonly number[], line: number): { start: number; end: number } {
  const start = starts[line] ?? 0
  const next = starts[line + 1]
  const rawEnd = next === undefined ? text.length : next - 1
  return { start, end: Math.max(start, Math.min(rawEnd, text.length)) }
}

/**
 * Simulation buffer: applies operations to a local text copy so subsequent
 * operations compute against post-edit coordinates, and records the emitted
 * primitives in application order.
 */
class Sim {
  readonly ops: VimOp[] = []
  text: string

  constructor(text: string) {
    this.text = text
  }

  /** Replace a span with newline-free text. */
  replace(start: number, end: number, text: string): void {
    const from = Math.max(0, Math.min(start, this.text.length))
    const to = Math.max(from, Math.min(end, this.text.length))
    this.ops.push({ type: 'replace', start: from, end: to, text })
    this.text = this.text.slice(0, from) + text + this.text.slice(to)
  }

  /** Insert a line break (document split) at one offset. */
  break(at: number): void {
    const atClamped = Math.max(0, Math.min(at, this.text.length))
    this.ops.push({ type: 'break', at: atClamped })
    this.text = this.text.slice(0, atClamped) + '\n' + this.text.slice(atClamped)
  }

  move(to: number): void {
    this.ops.push({ type: 'move', to: Math.max(0, Math.min(to, this.text.length)) })
  }

  select(start: number, end: number): void {
    const from = Math.max(0, Math.min(start, this.text.length))
    const to = Math.max(0, Math.min(end, this.text.length))
    this.ops.push({ type: 'select', start: Math.min(from, to), end: Math.max(from, to) })
  }

  undo(): void {
    this.ops.push({ type: 'undo' })
  }
}

/** Clamp one offset into one line's span. */
function clampToLine(at: number, line: { start: number; end: number }): number {
  return Math.max(line.start, Math.min(at, line.end))
}

/** First non-blank offset of one line (its end when the line is all blank). */
function firstNonBlank(text: string, line: { start: number; end: number }): number {
  for (let i = line.start; i < line.end; i += 1) {
    if (classOf(text, i) !== 'blank') return i
  }
  return line.end
}

/**
 * Splice one paste of `text` at `cursor` and answer the offset just past the
 * spliced content. Text carrying newlines (a register filled by `dw` across a
 * line end) rides break/replace primitive pairs — the face never receives a
 * literal newline.
 */
function splicePaste(sim: Sim, cursor: number, text: string): number {
  const parts = text.split('\n')
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? ''
    if (part !== '') sim.replace(cursor, cursor, part)
    cursor += part.length
    if (i < parts.length - 1) {
      sim.break(cursor)
      cursor += 1
    }
  }
  return cursor
}

/**
 * Forward word-start motion (`w`): leave the current class run, skip blanks,
 * land on the next run's head (or end of document).
 */
function wordForward(text: string, from: number): number {
  let i = from
  const cls = classOf(text, i)
  if (cls !== 'blank') {
    while (i < text.length && classOf(text, i) === cls) i += 1
  }
  while (i < text.length && classOf(text, i) === 'blank') i += 1
  return i
}

/**
 * Backward word-start motion (`b`): skip blanks backward, then the run of
 * the class met, landing on its head.
 */
function wordBackward(text: string, from: number): number {
  let i = from
  while (i > 0 && classOf(text, i - 1) === 'blank') i -= 1
  if (i === 0) return 0
  const cls = classOf(text, i - 1)
  while (i > 0 && classOf(text, i - 1) === cls) i -= 1
  return i
}

/**
 * Forward word-end motion (`e`): advance out of blanks, then to the tail of
 * the run found.
 */
function wordEnd(text: string, from: number): number {
  let i = from + 1
  while (i < text.length && classOf(text, i) === 'blank') i += 1
  if (i >= text.length) return Math.max(from, text.length - 1)
  const cls = classOf(text, i)
  while (i + 1 < text.length && classOf(text, i + 1) === cls) i += 1
  return i
}

/** Find-motion char position: N-th occurrence of `ch` on the caret's line (null when absent). */
function findInLine(
  text: string,
  caret: number,
  kind: FindKind,
  ch: string,
  count: number,
): number | null {
  const starts = lineStarts(text)
  const line = lineSpan(text, starts, lineOf(starts, caret))
  let hits = 0
  if (kind === 'f' || kind === 't') {
    for (let i = caret + 1; i < line.end; i += 1) {
      if (text[i] === ch) {
        hits += 1
        if (hits >= count) return i
      }
    }
    return null
  }
  for (let i = caret - 1; i >= line.start; i -= 1) {
    if (text[i] === ch) {
      hits += 1
      if (hits >= count) return i
    }
  }
  return null
}

/** Index of one offset's display row within a visual-line map (row starts sorted, [0] === 0). */
function visualRowOf(vlines: readonly number[], at: number): number {
  let lo = 0
  let hi = vlines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((vlines[mid] ?? 0) <= at) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * The `gj`/`gk` motion: move by display rows over the controller-measured
 * visual-line map, riding the caret's screen column (its distance from the
 * current row's start — never the logical wantColumn, which counts from the
 * logical line start and would land wrong on wrapped rows). The caret clamps
 * to the logical line's end, never past it. Vim treats these as exclusive
 * charwise motions for operators — unlike the linewise `j`/`k`. Without a
 * map the motion degrades to logical `j`/`k` (identical on unwrapped
 * content).
 * @param dir signed row count (already count-multiplied; negative = up).
 */
function visualRowMotion(doc: VimDoc, caret: number, dir: number): MotionTarget | null {
  const vlines = doc.vlines ?? null
  if (vlines === null || vlines.length === 0 || (vlines[0] ?? -1) !== 0) {
    return resolveMotion(doc.text, caret, dir > 0 ? 'j' : 'k', Math.abs(dir), null)
  }
  const text = doc.text
  const row = visualRowOf(vlines, caret)
  const target = Math.max(0, Math.min(row + dir, vlines.length - 1))
  const starts = lineStarts(text)
  const column = caret - (vlines[row] ?? 0)
  const rowStart = vlines[target] ?? 0
  const targetLine = lineSpan(text, starts, lineOf(starts, Math.min(rowStart, text.length)))
  const land = clampToLine(rowStart + column, targetLine)
  // 'clear' keeps the screen column out of wantColumn: that register is the
  // logical j/k column; mixing the two coordinate systems mis-lands motions.
  return { from: caret, to: land, land, vertical: false, want: 'clear' }
}

/** Invert a find kind (`,` repeats the last find in the opposite direction). */
function invertFind(kind: FindKind): FindKind {
  switch (kind) {
    case 'f': return 'F'
    case 'F': return 'f'
    case 't': return 'T'
    case 'T': return 't'
  }
}

/**
 * A resolved motion: the [from, to) char span it addresses (to exclusive) —
 * or a line range for linewise targets — plus the caret landing for a plain
 * (non-operator) use and how the wanted column evolves. Span end and landing
 * differ where vim distinguishes them: `e`/`f` include the touched char in
 * the span but land on it; `$` spans through the line end but lands on the
 * last character.
 */
interface MotionTarget {
  readonly from: number
  /** Exclusive span end for charwise motions (undefined for linewise). */
  readonly to?: number
  /** Caret landing for a plain motion (defaults to `to ?? from`). */
  readonly land?: number
  /** Linewise motions carry the inclusive target line index. */
  readonly targetLine?: number
  readonly vertical: boolean
  /** What happens to the wanted column after this motion. */
  readonly want: 'preserve' | 'set' | 'clear'
}

/**
 * Resolve one motion key against a document state.
 * @returns the target, or null when the key is not a motion (or the find target is absent).
 */
function resolveMotion(
  text: string,
  caret: number,
  key: string,
  count: number,
  find: { kind: FindKind; char: string } | null,
): MotionTarget | null {
  const starts = lineStarts(text)
  const lineIndex = lineOf(starts, caret)
  const line = lineSpan(text, starts, lineIndex)
  switch (key) {
    case 'h':
    case 'ArrowLeft':
    case 'Backspace': {
      const from = Math.max(line.start, caret - count)
      return { from, to: caret, land: from, vertical: false, want: 'clear' }
    }
    case 'l':
    case 'ArrowRight':
    case ' ': {
      const to = Math.min(line.end, caret + count)
      return { from: caret, to, land: to, vertical: false, want: 'clear' }
    }
    case 'j':
    case 'ArrowDown': {
      const target = Math.min(lineIndex + count, starts.length - 1)
      return { from: caret, targetLine: target, vertical: true, want: 'preserve' }
    }
    case 'k':
    case 'ArrowUp': {
      const target = Math.max(lineIndex - count, 0)
      return { from: caret, targetLine: target, vertical: true, want: 'preserve' }
    }
    case '0':
    case 'Home':
      return { from: line.start, to: caret, land: line.start, vertical: false, want: 'clear' }
    case '^': {
      const from = firstNonBlank(text, line)
      return { from, to: caret, land: from, vertical: false, want: 'clear' }
    }
    case '$':
    case 'End': {
      const target = lineSpan(text, starts, Math.min(lineIndex + count - 1, starts.length - 1))
      return {
        from: caret,
        to: target.end,
        land: Math.max(target.start, target.end - 1),
        vertical: false,
        want: 'clear',
      }
    }
    case 'w': {
      let to = caret
      for (let n = 0; n < count; n += 1) to = wordForward(text, to)
      return { from: caret, to, land: to, vertical: false, want: 'clear' }
    }
    case 'b': {
      let to = caret
      for (let n = 0; n < count; n += 1) to = wordBackward(text, to)
      return { from: to, to: caret, land: to, vertical: false, want: 'clear' }
    }
    case 'e': {
      let land = caret
      for (let n = 0; n < count; n += 1) land = wordEnd(text, land)
      return { from: caret, to: land + 1, land, vertical: false, want: 'clear' }
    }
    case 'G': {
      const target = count === 1 ? starts.length - 1 : Math.min(count - 1, starts.length - 1)
      return {
        from: caret,
        targetLine: target,
        land: firstNonBlank(text, lineSpan(text, starts, target)),
        vertical: true,
        want: 'set',
      }
    }
    case 'gg': {
      const target = Math.max(0, Math.min(count - 1, starts.length - 1))
      return {
        from: caret,
        targetLine: target,
        land: firstNonBlank(text, lineSpan(text, starts, target)),
        vertical: true,
        want: 'set',
      }
    }
    case 'f':
    case 'F':
    case 't':
    case 'T':
    case ';':
    case ',': {
      if (find === null) return null
      const at = findInLine(text, caret, find.kind, find.char, count)
      if (at === null) return { from: caret, to: caret, land: caret, vertical: false, want: 'clear' }
      // `f`/`F` include the found char in the span and land on it; `t`/`T`
      // stop one short in both readings.
      switch (find.kind) {
        case 'f': return { from: caret, to: at + 1, land: at, vertical: false, want: 'clear' }
        case 'F': return { from: at, to: caret, land: at, vertical: false, want: 'clear' }
        case 't': return { from: caret, to: at, land: at - 1, vertical: false, want: 'clear' }
        case 'T': return { from: at + 1, to: caret, land: at + 1, vertical: false, want: 'clear' }
      }
    }
    default:
      return null
  }
}

/** Column-preserving landing offset for a vertical motion. */
function verticalLanding(text: string, targetLine: number, column: number): number {
  const target = lineSpan(text, lineStarts(text), targetLine)
  return clampToLine(target.start + column, target)
}

/** Landing offset for a motion used as a plain caret move. */
function landingOf(text: string, caret: number, motion: MotionTarget, wantColumn: number | null): number {
  if (motion.land !== undefined) return motion.land
  if (motion.targetLine !== undefined) {
    const col = wantColumn ?? (caret - lineSpan(text, lineStarts(text), lineOf(lineStarts(text), caret)).start)
    return verticalLanding(text, motion.targetLine, col)
  }
  /* v8 ignore next 2 -- every motion resolves land or targetLine; this
     return names the type's floor for a motion that supplies neither. */
  return motion.to ?? caret
}

/** Reset every pending prefix (operator, count, g/find/replace waits). */
function clearPending(state: VimMachineState): VimMachineState {
  return {
    ...state,
    pendingOperator: null,
    count: null,
    pendingG: false,
    pendingFind: null,
    pendingReplace: false,
  }
}

/** Whether the key event carries no browser modifiers. */
function plain(ev: VimKey): boolean {
  return !ev.ctrl && !ev.meta && !ev.alt
}

/** Modifier-only keydowns (Shift and friends) never reach any binding. */
function isModifierOnly(key: string): boolean {
  return ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Compose']
    .includes(key)
}

/** Keys that always pass in NORMAL mode (browser-owned: focus traversal, function keys). */
function passesNormal(ev: VimKey): boolean {
  if (isModifierOnly(ev.key)) return true
  if (/^F(?:1[0-2]|[1-9])$/u.test(ev.key)) return true
  if (ev.key === 'Tab') return true
  // Modified keys stay browser-owned (Ctrl+R reload, Cmd+C copy, …).
  return ev.ctrl || ev.meta
}

/** INSERT-mode step: only Escape is owned. */
function stepInsert(state: VimMachineState, doc: VimDoc, ev: VimKey): VimStep {
  if (ev.key !== 'Escape' || !plain(ev)) return { state, consume: false, ops: [] }
  // Vim's Escape backs the caret off the character it sat on (except at BOL).
  const line = lineSpan(doc.text, lineStarts(doc.text), lineOf(lineStarts(doc.text), doc.caret))
  const to = doc.caret > line.start ? doc.caret - 1 : doc.caret
  return {
    state: { ...clearPending(state), mode: 'normal', wantColumn: null },
    consume: true,
    ops: [{ type: 'move', to }],
  }
}

/**
 * Fold one key event against the document.
 * @param state - machine state before the key.
 * @param doc - the document snapshot.
 * @param ev - the normalized key.
 * @returns the next state, consumption verdict, and ordered operations.
 */
export function step(state: VimMachineState, doc: VimDoc, ev: VimKey): VimStep {
  if (state.mode === 'insert') return stepInsert(state, doc, ev)
  // Modified and browser-owned keys stay the browser's in every modal mode.
  if (!plain(ev) || passesNormal(ev)) {
    return { state: clearPending(state), consume: false, ops: [] }
  }
  if (state.visual !== null) return stepVisual(state, state.visual, doc, ev)
  return stepNormal(state, doc, ev)
}

function stepNormal(state: VimMachineState, doc: VimDoc, ev: VimKey): VimStep {
  const sim = new Sim(doc.text)
  const count = state.count ?? 1
  const caret = doc.caret
  const starts = lineStarts(doc.text)
  const line = lineSpan(doc.text, starts, lineOf(starts, caret))
  const col = caret - line.start

  // --- pending second keys -------------------------------------------------
  if (state.pendingFind !== null) {
    if (ev.key.length !== 1) return { state: clearPending(state), consume: true, ops: [] }
    const find = { kind: state.pendingFind, char: ev.key }
    const motion = resolveMotion(doc.text, caret, find.kind, count, find)
    const landed = motion === null ? caret : landingOf(doc.text, caret, motion, state.wantColumn)
    if (state.pendingOperator !== null) {
      return applyOperatorMotion(state, sim, caret, state.pendingOperator, motion)
    }
    return {
      state: { ...clearPending(state), lastFind: find, wantColumn: motion?.want === 'preserve' ? state.wantColumn : null },
      consume: true,
      ops: [{ type: 'move', to: landed }],
    }
  }
  if (state.pendingReplace) {
    if (ev.key.length !== 1) return { state: clearPending(state), consume: true, ops: [] }
    const end = Math.min(line.end, caret + count)
    if (end > caret) {
      sim.replace(caret, end, ev.key.repeat(end - caret))
      sim.move(end - 1)
    } else {
      sim.move(caret)
    }
    return { state: clearPending(state), consume: true, ops: sim.ops }
  }
  if (state.pendingG) {
    if (ev.key === 'g') {
      const motion = resolveMotion(doc.text, caret, 'gg', count, null)
      if (state.pendingOperator !== null) {
        return applyOperatorMotion(state, sim, caret, state.pendingOperator, motion)
      }
      return finishPlainMotion(state, sim, caret, motion, col, state.wantColumn)
    }
    if (ev.key === 'j' || ev.key === 'k') {
      const motion = visualRowMotion(doc, caret, ev.key === 'j' ? count : -count)
      if (state.pendingOperator !== null) {
        return applyOperatorMotion(state, sim, caret, state.pendingOperator, motion)
      }
      return finishPlainMotion(state, sim, caret, motion, col, state.wantColumn)
    }
    // Any other key cancels the gg wait and re-runs as an ordinary key.
    return stepNormal(clearPending(state), doc, ev)
  }

  // --- count prefixes ------------------------------------------------------
  const nextCount = countDigitOf(state, ev.key)
  if (nextCount !== null) {
    return { state: { ...state, count: nextCount }, consume: true, ops: [] }
  }

  // --- operator doubling (dd/cc/yy) ----------------------------------------
  if (state.pendingOperator !== null && ev.key === state.pendingOperator) {
    const first = lineOf(starts, caret)
    const last = Math.min(first + count - 1, starts.length - 1)
    return applyLinewise(state, sim, state.pendingOperator, first, last)
  }

  // --- operator + motion ---------------------------------------------------
  if (state.pendingOperator !== null) {
    const operator = state.pendingOperator
    // cw behaves as ce on a non-blank: the change stops at the word's end
    // instead of eating trailing whitespace.
    const motionKey = operator === 'c' && ev.key === 'w' && classOf(doc.text, caret) !== 'blank'
      ? 'e'
      : ev.key
    // Find and gg wait for their second key with the operator kept pending.
    if (motionKey === 'f' || motionKey === 'F' || motionKey === 't' || motionKey === 'T') {
      return { state: { ...state, pendingFind: motionKey }, consume: true, ops: [] }
    }
    if (motionKey === 'g') {
      return { state: { ...state, pendingG: true }, consume: true, ops: [] }
    }
    const find = findArgumentOf(state, motionKey)
    if ((motionKey === ';' || motionKey === ',') && find === null) {
      return { state: clearPending(state), consume: true, ops: [] }
    }
    const motion = resolveMotion(doc.text, caret, motionKey, count, find)
    if (motion === null) {
      // Not a motion: the operator cancels; the key is consumed unmapped.
      return { state: clearPending(state), consume: true, ops: [] }
    }
    return applyOperatorMotion(state, sim, caret, operator, motion)
  }

  // --- operator and wait starts -------------------------------------------
  if (ev.key === 'd' || ev.key === 'c' || ev.key === 'y') {
    return { state: { ...state, pendingOperator: ev.key }, consume: true, ops: [] }
  }
  const wait = startPendingWait(state, ev.key)
  if (wait !== null) return wait
  if (ev.key === ';' || ev.key === ',') {
    const find = findArgumentOf(state, ev.key)
    if (find === null) return { state, consume: true, ops: [] }
    const motion = resolveMotion(doc.text, caret, ev.key, count, find)
    return finishPlainMotion(state, sim, caret, motion, col, state.wantColumn)
  }

  // --- plain motions -------------------------------------------------------
  const motion = resolveMotion(doc.text, caret, ev.key, count, null)
  if (motion !== null) {
    return finishPlainMotion(state, sim, caret, motion, col, state.wantColumn)
  }

  // --- single-key edits ----------------------------------------------------
  switch (ev.key) {
    case 'r': {
      return { state: { ...state, pendingReplace: true }, consume: true, ops: [] }
    }
    case 'x':
    case 'X':
    case 's': {
      // x deletes at/after the caret, X before it; s combines x with insert.
      const span = ev.key === 'X'
        ? { start: Math.max(line.start, caret - count), end: caret }
        : { start: caret, end: Math.min(line.end, caret + count) }
      if (span.end <= span.start) return { state: clearPending(state), consume: true, ops: [] }
      const deleted = doc.text.slice(span.start, span.end)
      sim.replace(span.start, span.end, '')
      sim.move(span.start)
      if (ev.key === 's') {
        return { state: { ...clearPending(state), mode: 'insert' }, consume: true, ops: sim.ops }
      }
      return {
        state: { ...clearPending(state), register: { text: deleted, linewise: false } },
        consume: true,
        ops: sim.ops,
      }
    }
    case 'D':
    case 'C': {
      const deleted = doc.text.slice(caret, line.end)
      sim.replace(caret, line.end, '')
      sim.move(caret)
      return ev.key === 'D'
        ? {
          state: { ...clearPending(state), register: { text: deleted, linewise: false } },
          consume: true,
          ops: sim.ops,
        }
        : { state: { ...clearPending(state), mode: 'insert' }, consume: true, ops: sim.ops }
    }
    case 'p':
    case 'P': {
      const reg = state.register
      if (reg.text === '') return { state: clearPending(state), consume: true, ops: [] }
      if (reg.linewise) {
        // p opens below the current line, P above; count repeats the lines.
        const anchor = ev.key === 'p' ? line.end : line.start
        let cursor = anchor
        for (let n = 0; n < count; n += 1) {
          sim.break(cursor)
          cursor = splicePaste(sim, cursor + 1, reg.text)
        }
        sim.move(anchor + 1)
        return { state: clearPending(state), consume: true, ops: sim.ops }
      }
      // Charwise paste splices the register at the landing offset.
      const at = ev.key === 'p' ? Math.min(caret + 1, line.end) : caret
      const cursor = splicePaste(sim, at, reg.text)
      sim.move(Math.max(at, cursor - 1))
      return { state: clearPending(state), consume: true, ops: sim.ops }
    }
    case 'o':
    case 'O': {
      const at = ev.key === 'o' ? line.end : line.start
      sim.break(at)
      // The split leaves the caret after the break: `o` lands on the opened
      // line directly; `O` backs up onto the line opened above.
      sim.move(ev.key === 'o' ? at + 1 : at)
      return {
        state: { ...clearPending(state), mode: 'insert', wantColumn: null },
        consume: true,
        ops: sim.ops,
      }
    }
    case 'u': {
      for (let n = 0; n < count; n += 1) sim.undo()
      return { state: clearPending(state), consume: true, ops: sim.ops }
    }
    case 'i':
      return { state: { ...clearPending(state), mode: 'insert', wantColumn: null }, consume: true, ops: [] }
    case 'I': {
      sim.move(firstNonBlank(doc.text, line))
      return { state: { ...clearPending(state), mode: 'insert', wantColumn: null }, consume: true, ops: sim.ops }
    }
    case 'a': {
      sim.move(Math.min(line.end, caret + 1))
      return { state: { ...clearPending(state), mode: 'insert', wantColumn: null }, consume: true, ops: sim.ops }
    }
    case 'A': {
      sim.move(line.end)
      return { state: { ...clearPending(state), mode: 'insert', wantColumn: null }, consume: true, ops: sim.ops }
    }
    case 'v':
    case 'V': {
      // Visual entry: the anchor sits on the caret; `v` starts charwise over
      // the character under it, `V` linewise over the whole line.
      const visual: VisualState = { anchor: caret, caret, linewise: ev.key === 'V' }
      selectVisual(sim, visual)
      return { state: { ...clearPending(state), visual }, consume: true, ops: sim.ops }
    }
    default: {
      // Unmapped printable in NORMAL mode: consumed, no-op — modal editing never types.
      if (ev.key.length === 1) return { state: clearPending(state), consume: true, ops: [] }
      return { state, consume: false, ops: [] }
    }
  }
}

/**
 * Project one visual selection onto the document as a `select` operation:
 * charwise covers [min(anchor, caret), max(anchor, caret) + 1) — the
 * character under the moving caret is included, matching the block-caret
 * posture — and linewise covers the start of the first addressed line
 * through the end of the last (the terminating newline stays out).
 */
function selectVisual(sim: Sim, vis: VisualState): void {
  const starts = lineStarts(sim.text)
  if (vis.linewise) {
    const first = Math.min(lineOf(starts, vis.anchor), lineOf(starts, vis.caret))
    const last = Math.max(lineOf(starts, vis.anchor), lineOf(starts, vis.caret))
    const start = starts[first] ?? 0
    sim.select(start, Math.max(start, lineSpan(sim.text, starts, last).end))
    return
  }
  const from = Math.min(vis.anchor, vis.caret)
  const to = Math.min(sim.text.length, Math.max(vis.anchor, vis.caret) + 1)
  if (to > from) sim.select(from, to)
}

/** Collapse out of visual mode: pendings reset, selection dropped. */
function dropVisual(state: VimMachineState): VimMachineState {
  return { ...clearPending(state), visual: null }
}

function stepVisual(state: VimMachineState, vis: VisualState, doc: VimDoc, ev: VimKey): VimStep {
  const sim = new Sim(doc.text)
  const count = state.count ?? 1
  const caret = vis.caret
  const starts = lineStarts(doc.text)
  const line = lineSpan(doc.text, starts, lineOf(starts, caret))
  const col = caret - line.start

  // --- pending second keys (shared waits, visual-preserving) ---------------
  if (state.pendingFind !== null) {
    if (ev.key.length !== 1) {
      sim.move(caret)
      return { state: dropVisual(state), consume: true, ops: sim.ops }
    }
    const find = { kind: state.pendingFind, char: ev.key }
    const extended = finishVisualMotion(
      state, vis, sim, caret, resolveMotion(doc.text, caret, find.kind, count, find), col,
    )
    return { ...extended, state: { ...extended.state, lastFind: find } }
  }
  if (state.pendingG) {
    if (ev.key === 'g') {
      return finishVisualMotion(state, vis, sim, caret, resolveMotion(doc.text, caret, 'gg', count, null), col)
    }
    if (ev.key === 'j' || ev.key === 'k') {
      return finishVisualMotion(
        state, vis, sim, caret,
        visualRowMotion(doc, caret, ev.key === 'j' ? count : -count), col,
      )
    }
    // Any other key cancels the gg wait (the selection survives) and re-runs
    // as an ordinary key.
    return stepVisual(clearPending(state), vis, doc, ev)
  }

  // --- leaves and flavor switches ------------------------------------------
  if (ev.key === 'Escape' || ev.key === 'v' || ev.key === 'V') {
    const linewise = ev.key === 'V'
    if (ev.key === 'Escape' || vis.linewise === linewise) {
      // Escape, or a repeat of the entry key, collapses back to NORMAL.
      sim.move(caret)
      return { state: dropVisual(state), consume: true, ops: sim.ops }
    }
    const next: VisualState = { ...vis, linewise }
    selectVisual(sim, next)
    return { state: { ...clearPending(state), visual: next }, consume: true, ops: sim.ops }
  }

  // --- operators over the selection -----------------------------------------
  const deletes = ev.key === 'd' || ev.key === 'x' || ev.key === 'D'
  const yanks = ev.key === 'y' || ev.key === 'Y'
  const changes = ev.key === 'c' || ev.key === 's' || ev.key === 'C'
  if (deletes || yanks || changes) {
    const operator: 'd' | 'c' | 'y' = deletes ? 'd' : changes ? 'c' : 'y'
    // Uppercase operator keys act linewise regardless of the visual flavor
    // (vim's D/Y/C); otherwise the selection's flavor decides.
    const linewise = vis.linewise || ev.key === 'D' || ev.key === 'Y' || ev.key === 'C'
    const anchorLine = lineOf(starts, vis.anchor)
    const caretLine = lineOf(starts, vis.caret)
    const applied = linewise
      ? applyLinewise(state, sim, operator, Math.min(anchorLine, caretLine), Math.max(anchorLine, caretLine))
      : applyCharwise(
        state, sim, operator,
        Math.min(vis.anchor, vis.caret),
        Math.min(doc.text.length, Math.max(vis.anchor, vis.caret) + 1),
      )
    // The operator completions carry the machine out of visual mode; a yank
    // leaves the DOM selection live, so it collapses at the selection head.
    const collapse = linewise ? starts[Math.min(anchorLine, caretLine)] ?? 0 : Math.min(vis.anchor, vis.caret)
    return {
      state: { ...applied.state, visual: null },
      consume: true,
      ops: operator === 'y' ? [...applied.ops, { type: 'move', to: collapse }] : applied.ops,
    }
  }

  // --- count prefixes --------------------------------------------------------
  const nextCount = countDigitOf(state, ev.key)
  if (nextCount !== null) {
    return { state: { ...state, count: nextCount }, consume: true, ops: [] }
  }

  // --- wait starts -----------------------------------------------------------
  const wait = startPendingWait(state, ev.key)
  if (wait !== null) return wait
  const repeat = visualFindRepeat(state, vis, sim, caret, count, ev.key, col)
  if (repeat !== null) return repeat

  // --- motions extend the selection ------------------------------------------
  const motion = resolveMotion(doc.text, caret, ev.key, count, null)
  if (motion !== null) return finishVisualMotion(state, vis, sim, caret, motion, col)

  // Unmapped printable in visual mode: consumed, no-op — the selection stays.
  if (ev.key.length === 1) return { state: clearPending(state), consume: true, ops: [] }
  return { state, consume: false, ops: [] }
}

/**
 * `;`/`,` inside visual mode: repeat the remembered find as a selection
 * extension (a remembered-find miss consumes the key and keeps the selection).
 * @returns the step, or null when the key repeats nothing (not a repeat key, or no find remembered).
 */
function visualFindRepeat(
  state: VimMachineState,
  vis: VisualState,
  sim: Sim,
  caret: number,
  count: number,
  key: string,
  col: number,
): VimStep | null {
  if (key !== ';' && key !== ',') return null
  const find = findArgumentOf(state, key)
  if (find === null) return { state: clearPending(state), consume: true, ops: [] }
  return finishVisualMotion(state, vis, sim, caret, resolveMotion(sim.text, caret, key, count, find), col)
}

/** Visual-motion completion: extend the selection and maintain the wanted column. */
function finishVisualMotion(
  state: VimMachineState,
  vis: VisualState,
  sim: Sim,
  caret: number,
  motion: MotionTarget | null,
  col: number,
): VimStep {
  if (motion === null) return { state: clearPending(state), consume: true, ops: [] }
  const to = Math.max(0, Math.min(landingOf(sim.text, caret, motion, state.wantColumn), sim.text.length))
  const next: VisualState = { ...vis, caret: to }
  selectVisual(sim, next)
  const want = motion.want === 'preserve' ? (state.wantColumn ?? col)
    : motion.want === 'set' ? to - lineSpan(sim.text, lineStarts(sim.text), lineOf(lineStarts(sim.text), to)).start
      : null
  return { state: { ...clearPending(state), visual: next, wantColumn: want }, consume: true, ops: sim.ops }
}

/** Fold one count digit into the pending count; null when the key is none (a bare `0` stays a motion). */
function countDigitOf(state: VimMachineState, key: string): number | null {
  if (key >= '1' && key <= '9') return (state.count ?? 0) * 10 + Number(key)
  if (key === '0' && state.count !== null) return state.count * 10
  return null
}

/** Start the `g`/find wait for one key (operator-free); null when the key starts none. */
function startPendingWait(state: VimMachineState, key: string): VimStep | null {
  if (key === 'g') return { state: { ...state, pendingG: true }, consume: true, ops: [] }
  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return { state: { ...state, pendingFind: key }, consume: true, ops: [] }
  }
  return null
}

/** The `;`/`,` repeat argument: the last find, inverted for `,`. */
function findArgumentOf(state: VimMachineState, key: string): { kind: FindKind; char: string } | null {
  if (key !== ';' && key !== ',') return null
  if (state.lastFind === null) return null
  return key === ';'
    ? state.lastFind
    : { kind: invertFind(state.lastFind.kind), char: state.lastFind.char }
}

/** Plain-motion completion: move the caret and maintain the wanted column. */
function finishPlainMotion(
  state: VimMachineState,
  sim: Sim,
  caret: number,
  motion: MotionTarget | null,
  col: number,
  wantColumn: number | null,
): VimStep {
  if (motion === null) return { state, consume: true, ops: [] }
  const to = landingOf(sim.text, caret, motion, wantColumn)
  sim.move(to)
  const want = motion.want === 'preserve' ? (wantColumn ?? col) : motion.want === 'set' ? to - lineSpan(sim.text, lineStarts(sim.text), lineOf(lineStarts(sim.text), to)).start : null
  return { state: { ...clearPending(state), wantColumn: want }, consume: true, ops: sim.ops }
}

/** Operator over a resolved motion: derive the span, then apply d/c/y. */
function applyOperatorMotion(
  state: VimMachineState,
  sim: Sim,
  caret: number,
  operator: 'd' | 'c' | 'y',
  motion: MotionTarget | null,
): VimStep {
  if (motion === null) return { state: clearPending(state), consume: true, ops: [] }
  if (motion.targetLine !== undefined) {
    const first = lineOf(lineStarts(sim.text), caret)
    return applyLinewise(state, sim, operator, first, motion.targetLine)
  }
  const from = Math.min(motion.from, motion.to ?? motion.from)
  const to = Math.max(motion.from, motion.to ?? motion.from)
  return applyCharwise(state, sim, operator, from, to)
}

/**
 * Linewise operator application over lines [first, last]: yank stores the
 * lines; delete removes them with their terminators (the preceding line's
 * terminator goes with the final line so no blank line remains); change
 * keeps one empty line and enters insert.
 */
function applyLinewise(
  state: VimMachineState,
  sim: Sim,
  operator: 'd' | 'c' | 'y',
  first: number,
  last: number,
): VimStep {
  const starts = lineStarts(sim.text)
  const orderedFirst = Math.min(first, last)
  const orderedLast = Math.max(first, last)
  const spanStart = starts[orderedFirst] ?? 0
  const lastIsFinal = orderedLast + 1 >= starts.length
  // Delete spans carry the lines' trailing newlines; on the final line the
  // span reaches back past the preceding terminator instead, so no blank
  // line survives. Change keeps the line: its span never eats a terminator.
  const afterLast = starts[orderedLast + 1] ?? sim.text.length
  const deleteStart = lastIsFinal && orderedFirst > 0 ? spanStart - 1 : spanStart
  const deleteEnd = lastIsFinal ? sim.text.length : afterLast
  const changeEnd = lastIsFinal ? sim.text.length : afterLast - 1
  const deleted = sim.text.slice(spanStart, lastIsFinal ? sim.text.length : afterLast - 1)
  if (operator === 'y') {
    return {
      state: {
        ...clearPending(state),
        register: { text: deleted, linewise: true },
        wantColumn: null,
      },
      consume: true,
      ops: [],
    }
  }
  if (operator === 'c') {
    sim.select(spanStart, changeEnd)
    sim.replace(spanStart, changeEnd, '')
    sim.move(spanStart)
    return { state: { ...clearPending(state), mode: 'insert', wantColumn: null }, consume: true, ops: sim.ops }
  }
  sim.select(deleteStart, deleteEnd)
  sim.replace(deleteStart, deleteEnd, '')
  const landing = Math.min(lastIsFinal && orderedFirst > 0 ? starts[orderedFirst - 1] ?? 0 : spanStart, sim.text.length)
  sim.move(landing)
  return {
    state: { ...clearPending(state), register: { text: deleted, linewise: true }, wantColumn: null },
    consume: true,
    ops: sim.ops,
  }
}

/** Charwise operator application over the [from, to) span. */
function applyCharwise(
  state: VimMachineState,
  sim: Sim,
  operator: 'd' | 'c' | 'y',
  from: number,
  to: number,
): VimStep {
  if (operator === 'y') {
    return {
      state: {
        ...clearPending(state),
        register: { text: sim.text.slice(from, to), linewise: false },
        wantColumn: null,
      },
      consume: true,
      ops: [],
    }
  }
  const deleted = sim.text.slice(from, to)
  sim.select(from, to)
  sim.replace(from, to, '')
  const landing = Math.min(from, sim.text.length)
  sim.move(landing)
  if (operator === 'c') {
    return { state: { ...clearPending(state), mode: 'insert', wantColumn: null }, consume: true, ops: sim.ops }
  }
  return {
    state: { ...clearPending(state), register: { text: deleted, linewise: false }, wantColumn: null },
    consume: true,
    ops: sim.ops,
  }
}
