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
/**
 * Measure the display-row start offsets of one document rendering.
 * @param text - the detect-projection text (chip = one U+FFFC character).
 * @returns sorted row-start offsets ([0] === 0), or null when no strategy
 * could measure — callers degrade to logical `j`/`k`.
 */
export declare function measureVisualLines(text: string): readonly number[] | null;
