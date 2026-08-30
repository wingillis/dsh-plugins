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
export type VimOp = {
    readonly type: 'move';
    readonly to: number;
} | {
    readonly type: 'select';
    readonly start: number;
    readonly end: number;
} | {
    readonly type: 'replace';
    readonly start: number;
    readonly end: number;
    readonly text: string;
} | {
    readonly type: 'break';
    readonly at: number;
} | {
    readonly type: 'undo';
};
/** The composer document snapshot a key event is folded against. */
export interface VimDoc {
    /** Detect-projection text (chip = U+FFFC, newline = line boundary). */
    readonly text: string;
    /** Collapsed caret offset (selection focus end when a range is active). */
    readonly caret: number;
    /** Live range selection, when the user dragged one. */
    readonly selection: {
        readonly start: number;
        readonly end: number;
    } | null;
}
/** Normalized key event description. */
export interface VimKey {
    readonly key: string;
    readonly ctrl: boolean;
    readonly meta: boolean;
    readonly alt: boolean;
    readonly shift: boolean;
}
/** The single unnamed register (charwise or linewise). */
export interface VimRegister {
    readonly text: string;
    readonly linewise: boolean;
}
/** One-character find motions waiting for their target (`f`/`F`/`t`/`T`). */
export type FindKind = 'f' | 'F' | 't' | 'T';
/**
 * An active visual selection: the offset the selection grew from (`anchor`),
 * the moving end motions drive (`caret`, the machine's own caret while the
 * selection is live — the composer selection shows the derived span), and
 * whether the selection addresses whole lines.
 */
export interface VisualState {
    readonly anchor: number;
    readonly caret: number;
    readonly linewise: boolean;
}
/** Mutable machine state between key events. */
export interface VimMachineState {
    readonly mode: 'insert' | 'normal';
    /** Active visual selection (null outside visual mode). */
    readonly visual: VisualState | null;
    /** Operator awaiting its motion or its doubling (`dd`). */
    readonly pendingOperator: 'd' | 'c' | 'y' | null;
    /** Pending count prefix (null = none; resolved to 1 at use). */
    readonly count: number | null;
    /** `g` pressed, awaiting the second `g` of `gg`. */
    readonly pendingG: boolean;
    /** Find motion awaiting its target character. */
    readonly pendingFind: FindKind | null;
    /** `r` pressed, awaiting its replacement character. */
    readonly pendingReplace: boolean;
    /** Last completed find motion (`;`/`,` repeat it). */
    readonly lastFind: {
        readonly kind: FindKind;
        readonly char: string;
    } | null;
    /** Yank/delete register. */
    readonly register: VimRegister;
    /** Remembered column for vertical motions (null = take the current column). */
    readonly wantColumn: number | null;
}
/** One `step` outcome: the next state, whether the key was consumed, and the operations to apply in order. */
export interface VimStep {
    readonly state: VimMachineState;
    readonly consume: boolean;
    readonly ops: readonly VimOp[];
}
/** Fresh machine state: insert mode (the composer's native posture), empty everything. */
export declare const INITIAL_VIM_STATE: VimMachineState;
/**
 * Fold one key event against the document.
 * @param state - machine state before the key.
 * @param doc - the document snapshot.
 * @param ev - the normalized key.
 * @returns the next state, consumption verdict, and ordered operations.
 */
export declare function step(state: VimMachineState, doc: VimDoc, ev: VimKey): VimStep;
