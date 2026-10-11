/**
 * DOM geometry for the modal block caret: measures the on-screen box of the
 * character under the composer's collapsed DOM selection, expressed relative
 * to one element inside the same composer card (the badge overlay's anchor).
 * Pure DOM reads — no React, no editor state; callers re-measure on
 * selection, scroll, and layout changes.
 */

/** One measured block-caret box (CSS pixels, relative to the anchor element). */
export interface CaretBlock {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Fraction of the composer's font size used when the caret has no character under it (line ends, empty drafts). */
const BARE_WIDTH_RATIO = 0.6

/** Pixel fallback when the font size itself is unreadable. */
const BARE_WIDTH_FLOOR = 8

/** Line height used when the surface reports `normal` and only the font size is measurable. */
const EMPTY_LINE_RATIO = 1.2

/**
 * The composer's editing surface of the card containing `root`.
 * @param root - any element rendered inside the composer card.
 * @returns the card's contenteditable, or null when `root` sits in no card or the card has no editable surface.
 */
export function composerEditableOf(root: Element | null): Element | null {
  const card = root?.closest('[data-composer-card]')
  if (card === null || card === undefined) return null
  return card.querySelector('[contenteditable="true"]')
}

/** The caret's fallback width: a fraction of the surface's own font size. */
function bareWidth(editable: Element): number {
  const size = parseFloat(getComputedStyle(editable).fontSize)
  return Number.isFinite(size) ? size * BARE_WIDTH_RATIO : BARE_WIDTH_FLOOR
}

/** A plain box view of one DOMRect, substituting the bare width when the rect is widthless. */
function boxOf(rect: DOMRect, fallbackWidth: number): CaretBlock {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width > 0 ? rect.width : fallbackWidth,
    height: rect.height,
  }
}

/**
 * The box the block caret covers for one collapsed range: the character at
 * the caret when one exists, otherwise a bare-width box at the caret's
 * position (the caret then sits past the last character of its text node).
 * @param editable - the composer's editing surface (font-size source).
 * @param range - the collapsed selection range inside it.
 * @returns the box, or null when the caret has no measurable position.
 */
function charBox(editable: Element, range: Range): CaretBlock | null {
  const width = bareWidth(editable)
  const node = range.startContainer
  if (node instanceof Text) {
    const text = node.data
    const at = range.startOffset
    if (at < text.length) {
      const span = document.createRange()
      span.setStart(node, at)
      span.setEnd(node, at + 1)
      return boxOf(span.getBoundingClientRect(), width)
    }
    if (at > 0) {
      // Line-end insertion cell: the block rides just past the previous
      // character, at that character's height.
      const span = document.createRange()
      span.setStart(node, at - 1)
      span.setEnd(node, at)
      const prev = span.getBoundingClientRect()
      if (prev.height > 0) {
        return { left: prev.right, top: prev.top, width, height: prev.height }
      }
    }
  }
  const box = range.getBoundingClientRect()
  if (box.height > 0 || box.width > 0) return boxOf(box, width)
  // Empty draft (or an unrendered caret node): no character geometry of its
  // own, so the block rides the surface's first line cell instead.
  return emptyBox(editable, width)
}

/**
 * The empty-draft fallback cell: the block caret anchored at the surface's
 * first line when the collapsed selection has no character geometry of its
 * own (an empty draft, or a caret on an unrendered node). Prefers the
 * contents range's first client rect (the line box at the insertion point);
 * falls back to the editable's own box inset by its padding, with the
 * line-height (or font-size-derived) height.
 * @param editable - the composer's editing surface.
 * @param width - the bare caret width.
 * @returns the fallback box, or null when even the surface is unmeasurable.
 */
function emptyBox(editable: Element, width: number): CaretBlock | null {
  const contents = editable.ownerDocument.createRange()
  contents.selectNodeContents(editable)
  // jsdom-style DOMs ship no Range client-rect API; the editable box below
  // is the fallback there too.
  const first = typeof contents.getClientRects === 'function' ? contents.getClientRects()[0] : undefined
  if (first !== undefined && first.height > 0) {
    return { left: first.left, top: first.top, width, height: first.height }
  }
  const box = editable.getBoundingClientRect()
  if (box.height <= 0) return null
  const style = getComputedStyle(editable)
  const pad = (value: string): number => {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const lineHeight = parseFloat(style.lineHeight)
  const size = parseFloat(style.fontSize)
  const height = Number.isFinite(lineHeight)
    ? lineHeight
    : Number.isFinite(size) ? size * EMPTY_LINE_RATIO : box.height
  return {
    left: box.left + pad(style.paddingLeft),
    top: box.top + pad(style.paddingTop),
    width,
    height,
  }
}

/**
 * Measure the block caret for the selection inside the composer card that
 * `anchor` renders in.
 * @param anchor - the overlay element the block will be positioned against.
 * @returns the block box relative to the anchor, or null while the anchor has
 * no card, the selection lives outside the card's surface, or the caret has
 * no measurable position (ranged selections get no block — they are their
 * own highlight).
 */
export function computeCaretBlock(anchor: HTMLElement | null): CaretBlock | null {
  if (anchor === null) return null
  const editable = composerEditableOf(anchor)
  if (editable === null) return null
  const view = anchor.ownerDocument.defaultView
  /* v8 ignore next -- defaultView is null only for a document without a browsing context; the overlay renders in the live one. */
  if (view === null) return null
  const selection = view.getSelection()
  /* v8 ignore next -- getSelection is null only while its window is closing; the overlay renders in the live one. */
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!range.collapsed) return null
  const node = range.startContainer
  if (node !== editable && !editable.contains(node)) return null
  const box = charBox(editable, range)
  if (box === null) return null
  const base = anchor.getBoundingClientRect()
  return {
    left: box.left - base.left,
    top: box.top - base.top,
    width: box.width,
    height: box.height,
  }
}
