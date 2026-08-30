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
  if (box.height <= 0 && box.width <= 0) return null
  return boxOf(box, width)
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
