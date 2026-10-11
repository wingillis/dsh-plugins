// @vitest-environment jsdom
/**
 * Component specs, props-direct: the toggle mirrors the persisted switch
 * (aria-pressed, active treatment, click routing); the badge renders the
 * mode line per modal mode; and the NORMAL-mode block caret measures from
 * the card's live DOM selection, positions against the overlay anchor, and
 * suppresses the composer's native caret for the same card.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en } from '../src/client/locales.ts'
import { VimBadge } from '../src/client/VimBadge.tsx'
import { VimToggle } from '../src/client/VimToggle.tsx'
import { computeCaretBlock, composerEditableOf } from '../src/client/blockCursor.ts'
import type { VimMode } from '../src/client/controller.ts'

afterEach(() => {
  cleanup()
  document.getSelection()?.removeAllRanges()
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
})

/** Install one rect answer for every range measurement (jsdom has no layout). */
function mockRangeRect(box: DOMRect): void {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    value: () => box,
    configurable: true,
  })
}

beforeAll(() => {
  // jsdom ships no layout observer; the badge only needs the callback channel.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

const t = makeTranslate(en)

/** One composer-card DOM fixture: card + editable surface with text, attached to the document. */
function cardFixture(): { card: HTMLDivElement; editable: HTMLDivElement } {
  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  editable.appendChild(document.createTextNode('hello'))
  card.appendChild(editable)
  document.body.appendChild(card)
  return { card, editable }
}

/** Collapse the document selection into one node at an offset. */
function collapseAt(node: Node, offset: number): void {
  const range = document.createRange()
  range.setStart(node, offset)
  range.setEnd(node, offset)
  document.getSelection()?.removeAllRanges()
  document.getSelection()?.addRange(range)
}

/** Render the badge with its overlay anchor inside a card fixture (the real overlay entry sits inside the card). */
function renderInCard(
  card: HTMLElement,
  enabled: ReturnType<typeof createSnapshotStore<boolean>>,
  mode: ReturnType<typeof createSnapshotStore<VimMode>>,
): HTMLElement {
  const holder = document.createElement('div')
  card.appendChild(holder)
  const { container } = render(
    <VimBadge useEnabled={bindSnapshotSelector(enabled)} useMode={bindSnapshotSelector(mode)} t={t} />,
    { container: holder },
  )
  return container
}

/** A flat rect stub (jsdom layout returns all zeros). */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect
}

describe('VimToggle', () => {
  it('mirrors the switch state and routes clicks to the toggle callback', () => {
    const enabled = createSnapshotStore(false)
    const mode = createSnapshotStore<VimMode>('insert')
    const toggle = vi.fn()
    render(<VimToggle
      useEnabled={bindSnapshotSelector(enabled)}
      useMode={bindSnapshotSelector(mode)}
      toggle={toggle}
      t={t}
    />)
    const button = screen.getByRole('button', { name: 'Vim' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(toggle).toHaveBeenCalledOnce()
  })

  it('presses reflect a live enabled flip', () => {
    const enabled = createSnapshotStore(false)
    const mode = createSnapshotStore<VimMode>('insert')
    render(<VimToggle
      useEnabled={bindSnapshotSelector(enabled)}
      useMode={bindSnapshotSelector(mode)}
      toggle={() => {}}
      t={t}
    />)
    expect(screen.getByRole('button', { name: 'Vim' }).getAttribute('aria-pressed')).toBe('false')
    act(() => { enabled.set(true) })
    expect(screen.getByRole('button', { name: 'Vim' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('VimBadge mode line', () => {
  it('renders the NORMAL line only while enabled and in normal mode', () => {
    const enabled = createSnapshotStore(true)
    const mode = createSnapshotStore<VimMode>('normal')
    render(<VimBadge useEnabled={bindSnapshotSelector(enabled)} useMode={bindSnapshotSelector(mode)} t={t} />)
    expect(screen.getByText('NORMAL')).toBeDefined()
    act(() => { mode.set('insert') })
    expect(screen.queryByText('NORMAL')).toBeNull()
    act(() => {
      mode.set('normal')
      enabled.set(false)
    })
    expect(screen.queryByText('NORMAL')).toBeNull()
  })

  it('renders the VISUAL line while a selection grows', () => {
    const enabled = createSnapshotStore(true)
    const mode = createSnapshotStore<VimMode>('visual')
    render(<VimBadge useEnabled={bindSnapshotSelector(enabled)} useMode={bindSnapshotSelector(mode)} t={t} />)
    expect(screen.getByText('VISUAL')).toBeDefined()
    act(() => { mode.set('normal') })
    expect(screen.queryByText('VISUAL')).toBeNull()
  })
})

describe('VimBadge block caret', () => {
  it('renders the block over the character under the collapsed selection', () => {
    const { card, editable } = cardFixture()
    collapseAt(editable.firstChild!, 1)
    mockRangeRect(rect(100, 50, 10, 20))
    const enabled = createSnapshotStore(true)
    const mode = createSnapshotStore<VimMode>('normal')
    renderInCard(card, enabled, mode)
    const overlay = screen.getByText('NORMAL').parentElement!
    const block = overlay.querySelector('[aria-hidden]') as HTMLElement
    expect(block).not.toBeNull()
    expect(block.style.left).toBe('100px')
    expect(block.style.top).toBe('50px')
    expect(block.style.width).toBe('10px')
    expect(block.style.height).toBe('20px')
    // The same card's native caret hides while the modal mode owns it.
    expect(editable.className).not.toBe('')
    act(() => { mode.set('insert') })
    expect(editable.className).toBe('')
  })

  it('keeps the native caret visible while disabled', () => {
    const { card, editable } = cardFixture()
    const enabled = createSnapshotStore(false)
    const mode = createSnapshotStore<VimMode>('insert')
    renderInCard(card, enabled, mode)
    expect(editable.className).toBe('')
  })

  it('clears the block when the selection moves outside the card surface', () => {
    const { card, editable } = cardFixture()
    collapseAt(editable.firstChild!, 1)
    mockRangeRect(rect(100, 50, 10, 20))
    const enabled = createSnapshotStore(true)
    const mode = createSnapshotStore<VimMode>('normal')
    renderInCard(card, enabled, mode)
    const overlay = screen.getByText('NORMAL').parentElement!
    expect(overlay.querySelector('[aria-hidden]')).not.toBeNull()
    const outside = document.createElement('div')
    outside.appendChild(document.createTextNode('elsewhere'))
    document.body.appendChild(outside)
    act(() => {
      collapseAt(outside.firstChild!, 0)
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(overlay.querySelector('[aria-hidden]')).toBeNull()
    // The modal mode still owns the card; only the block depends on the caret.
    expect(editable.className).not.toBe('')
  })
})

describe('computeCaretBlock geometry', () => {
  it('answers null for missing anchors, cards, and selections', () => {
    expect(computeCaretBlock(null)).toBeNull()
    expect(composerEditableOf(null)).toBeNull()
    const { card } = cardFixture()
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    expect(composerEditableOf(outside)).toBeNull()
    // In-card anchor, no selection yet (rangeCount 0): no block.
    const anchor = document.createElement('div')
    card.appendChild(anchor)
    expect(computeCaretBlock(anchor)).toBeNull()
    // A ranged selection (visual mode, native drag) is its own highlight.
    const editable = card.querySelector('[contenteditable="true"]')!
    const ranged = document.createRange()
    ranged.setStart(editable.firstChild!, 0)
    ranged.setEnd(editable.firstChild!, 2)
    document.getSelection()?.addRange(ranged)
    expect(computeCaretBlock(anchor)).toBeNull()
  })

  it('covers the character at the caret and falls back at the line end', () => {
    const { card, editable } = cardFixture()
    const anchor = document.createElement('div')
    card.appendChild(anchor)
    editable.style.fontSize = '10px'
    mockRangeRect(rect(30, 5, 6, 12))
    collapseAt(editable.firstChild!, 1)
    expect(computeCaretBlock(anchor)).toEqual({ left: 30, top: 5, width: 6, height: 12 })
    // The line-end insertion cell: a bare-width block just past the last char.
    collapseAt(editable.firstChild!, 5)
    expect(computeCaretBlock(anchor)).toEqual({ left: 36, top: 5, width: 6, height: 12 })
    mockRangeRect(rect(30, 5, 0, 12))
    collapseAt(editable.firstChild!, 5)
    expect(computeCaretBlock(anchor)).toEqual({ left: 30, top: 5, width: 6, height: 12 })
  })

  it('answers null when nothing measurable exists', () => {
    const { card, editable } = cardFixture()
    const anchor = document.createElement('div')
    card.appendChild(anchor)
    mockRangeRect(rect(0, 0, 0, 0))
    collapseAt(editable, 0)
    expect(computeCaretBlock(anchor)).toBeNull()
    const empty = document.createTextNode('')
    editable.appendChild(empty)
    collapseAt(empty, 0)
    expect(computeCaretBlock(anchor)).toBeNull()
    // A text-end caret whose previous character measures nothing falls
    // through to the collapsed range's own (also empty) box.
    collapseAt(editable.firstChild!, 5)
    expect(computeCaretBlock(anchor)).toBeNull()
  })

  it('anchors the block on the first line cell of an empty draft', () => {
    // The empty composer: no text node at all, and a collapsed selection
    // whose own box measures nothing — the block must still appear.
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.style.fontSize = '10px'
    card.appendChild(editable)
    document.body.appendChild(card)
    const anchor = document.createElement('div')
    card.appendChild(anchor)
    const spy = vi.spyOn(editable, 'getBoundingClientRect').mockReturnValue(rect(10, 20, 200, 16))
    mockRangeRect(rect(0, 0, 0, 0))
    collapseAt(editable, 0)
    // Bare width 10px × 0.6; height from the font-size line fallback (12px).
    expect(computeCaretBlock(anchor)).toEqual({ left: 10, top: 20, width: 6, height: 12 })
    spy.mockRestore()
  })

  it('derives the bare width from the surface font size', () => {
    const { card, editable } = cardFixture()
    const anchor = document.createElement('div')
    card.appendChild(anchor)
    editable.style.fontSize = '20px'
    mockRangeRect(rect(0, 0, 0, 12))
    collapseAt(editable, 0)
    expect(computeCaretBlock(anchor)).toEqual({ left: 0, top: 0, width: 12, height: 12 })
  })
})
