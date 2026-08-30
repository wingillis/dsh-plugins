/**
 * DOM geometry for the modal block caret: measures the on-screen box of the
 * character under the composer's collapsed DOM selection, expressed relative
 * to one element inside the same composer card (the badge overlay's anchor).
 * Pure DOM reads — no React, no editor state; callers re-measure on
 * selection, scroll, and layout changes.
 */
/** One measured block-caret box (CSS pixels, relative to the anchor element). */
export interface CaretBlock {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}
/**
 * The composer's editing surface of the card containing `root`.
 * @param root - any element rendered inside the composer card.
 * @returns the card's contenteditable, or null when `root` sits in no card or the card has no editable surface.
 */
export declare function composerEditableOf(root: Element | null): Element | null;
/**
 * Measure the block caret for the selection inside the composer card that
 * `anchor` renders in.
 * @param anchor - the overlay element the block will be positioned against.
 * @returns the block box relative to the anchor, or null while the anchor has
 * no card, the selection lives outside the card's surface, or the caret has
 * no measurable position (ranged selections get no block — they are their
 * own highlight).
 */
export declare function computeCaretBlock(anchor: HTMLElement | null): CaretBlock | null;
