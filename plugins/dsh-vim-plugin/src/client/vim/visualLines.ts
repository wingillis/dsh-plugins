/**
 * Display-row measurement for `gj`/`gk`: mirrors the focused composer editor
 * into an offscreen element with the editor's typography and the same
 * content-box width, then walks the detect-projection text (chip = one
 * U+FFFC) char by char reading each glyph's client rect to detect the rows
 * soft wrapping produced. Range client rects are engine-fragile (browsers
 * return empty lists for various focus/visibility states), so a canvas
 * word-wrap simulation answers whenever the rect walk could not measure —
 * and null (the caller degrades to `j`/`k`) when neither strategy can.
 * Pure DOM, no cordis/React; consulted lazily by the controller only while
 * the vim machine waits on a `g` prefix.
 */

/** Vertical distance (px) below which two glyph tops read as the same row. */
const ROW_TOLERANCE = 2

/** Typography properties that decide where the browser breaks lines. */
const TYPOGRAPHY_PROPS = [
  'direction', 'font-family', 'font-kerning', 'font-size', 'font-stretch', 'font-style',
  'font-variant', 'font-variant-ligatures', 'font-feature-settings', 'font-weight',
  'letter-spacing', 'word-spacing', 'tab-size', 'text-align', 'text-indent',
  'text-transform', 'text-rendering', 'text-wrap', 'white-space', 'white-space-collapse',
  'word-break', 'overflow-wrap', 'line-break', 'hyphens', 'box-sizing',
  'border-left-width', 'border-right-width', 'padding-left', 'padding-right',
] as const

/** The CSS font shorthand a canvas context accepts, built from computed styles. */
function canvasFont(styles: CSSStyleDeclaration): string {
  return [
    styles.fontStyle, styles.fontVariant, styles.fontWeight, styles.fontSize, styles.fontFamily,
  ].join(' ')
}

/**
 * Measure the display-row start offsets of one document rendering.
 * @param text - the detect-projection text (chip = one U+FFFC character).
 * @returns sorted row-start offsets ([0] === 0), or null when no strategy
 * could measure — callers degrade to logical `j`/`k`.
 */
export function measureVisualLines(text: string): readonly number[] | null {
  if (typeof document === 'undefined' || text === '') return null
  const host = document.activeElement
  if (!(host instanceof HTMLElement)) return null
  const styles = getComputedStyle(host)
  const clientWidth = host.clientWidth
  if (clientWidth <= 0) return null
  const contentBox = clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)
  if (!Number.isFinite(contentBox) || contentBox <= 0) return null
  const fromRects = rectRowStarts(text, styles, contentBox)
  if (fromRects !== null) return fromRects
  const fromCanvas = canvasRowStarts(text, styles, contentBox)
  return fromCanvas.length > 0 ? fromCanvas : null
}

/**
 * Primary strategy: a mirror element pinned offscreen (visible — visibility
 * tricks are exactly what collapses Range rects) carrying the editor's
 * typography, walked glyph by glyph.
 * @returns row starts, or null when the engine answered no rects at all.
 */
function rectRowStarts(text: string, styles: CSSStyleDeclaration, contentBox: number): readonly number[] | null {
  const mirror = document.createElement('div')
  try {
    for (const prop of TYPOGRAPHY_PROPS) {
      const value = styles.getPropertyValue(prop)
      if (value !== '') mirror.style.setProperty(prop, value)
    }
    Object.assign(mirror.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: `${contentBox}px`,
      height: 'auto',
      maxHeight: 'none',
      // The composer's own wrap posture; long unbroken runs break mid-word.
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
    } satisfies Partial<CSSStyleDeclaration>)
    mirror.textContent = text
    // Fixed-position off body: no ancestor stacking context, containment, or
    // scroll container of the composer can suppress or clip the mirror.
    document.body.appendChild(mirror)
    const node = mirror.firstChild
    if (node === null || node.nodeType !== Node.TEXT_NODE) return null
    const textNode = node as Text
    const range = document.createRange()
    let rowTop: number | null = null
    let measured = 0
    const starts: number[] = [0]
    for (let i = 0; i < text.length; i += 1) {
      range.setStart(textNode, i)
      range.setEnd(textNode, i + 1)
      const rect = range.getClientRects()[0]
      if (rect === undefined) continue
      measured += 1
      const top = rect.top
      const forced = i > 0 && text[i - 1] === '\n'
      if (rowTop === null) {
        rowTop = top
      } else if (forced || Math.abs(top - rowTop) > ROW_TOLERANCE) {
        starts.push(i)
        rowTop = top
      }
    }
    // Zero rects measured: this engine cannot answer Range geometry here —
    // hand the question to the canvas simulation instead of reporting a
    // bogus single-row map (which would freeze gj/gk in place).
    if (measured === 0) return null
    return starts
  } catch {
    return null
  } finally {
    mirror.remove()
  }
}

/**
 * Fallback strategy: greedy word-wrap simulation over canvas glyph widths —
 * break after the last space that fit, or mid-word when none did. Less exact
 * than the browser's own line breaking, but immune to Range rect quirks.
 */
function canvasRowStarts(text: string, styles: CSSStyleDeclaration, width: number): readonly number[] {
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx === null) return []
  ctx.font = canvasFont(styles)
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in spaced) spaced.letterSpacing = styles.letterSpacing
  const widthOf = (i: number): number => ctx.measureText(text[i] ?? '').width
  const starts: number[] = [0]
  /** Record the offset a fresh row opens at (deduped, bounded to real glyphs). */
  const openRow = (p: number): void => {
    if (p > 0 && p < text.length && starts[starts.length - 1] !== p) starts.push(p)
  }
  let rowStart = 0
  let x = 0
  let lastSpaceFit = -1
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? ''
    if (ch === '\n') {
      rowStart = i + 1
      x = 0
      lastSpaceFit = -1
      openRow(rowStart)
      continue
    }
    const w = widthOf(i)
    if (x > 0 && x + w > width) {
      if (lastSpaceFit >= rowStart) {
        // Word wrap: the row restarts after the space that fit.
        rowStart = lastSpaceFit + 1
      } else {
        // Break-word: the overflowing glyph opens the new row itself.
        rowStart = i
      }
      openRow(rowStart)
      // Lay the carried glyphs onto the fresh row.
      x = 0
      lastSpaceFit = -1
      for (let j = rowStart; j <= i; j += 1) {
        x += widthOf(j)
        if (text[j] === ' ') lastSpaceFit = j
      }
      continue
    }
    x += w
    if (ch === ' ') lastSpaceFit = i
  }
  return starts
}
