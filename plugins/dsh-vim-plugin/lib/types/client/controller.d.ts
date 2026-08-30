/**
 * VimController: the plugin's single apply-closure instance. Owns the pure
 * machine state, the persisted enabled preference, and the published mode;
 * `keydown` is the ComposerKeysService interceptor — it folds each keydown
 * through the machine and applies the resulting operations to the session's
 * editing face.
 */
import { type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ComposerEditFace } from '@deepseek-ai/dsh-client-ui-conversation/client';
/** Composer editor mode, published for the indicator surfaces. */
export type VimMode = 'insert' | 'normal' | 'visual';
/**
 * The vim mode controller.
 * @param enabledInitial - fallback when no preference is persisted (non-browser runs, first visit).
 */
export declare class VimController {
    /** Persisted master switch (localStorage; failures only disable persistence). */
    readonly enabled: SnapshotStore<boolean>;
    /** Live editor mode (transient; every load starts in insert). */
    readonly mode: SnapshotStore<VimMode>;
    private machine;
    constructor(enabledInitial: boolean);
    /**
     * Turn vim editing on or off; the machine resets so a re-enable starts clean in insert.
     * @param next whether the vim layer should intercept composer keys
     */
    setEnabled(next: boolean): void;
    /** The mode an indicator surface should show: visual outranks the underlying normal mode. */
    private publishedMode;
    /** Flip the master switch (the toggle button and badge gesture). */
    toggle(): void;
    /**
     * The ComposerKeysService interceptor: fold one keydown through the machine
     * and apply its operations. Everything runs synchronously inside the
     * keydown, so the editing face's reads observe each applied operation.
     * @param face - the focused session's editing face.
     * @param event - the raw keydown.
     * @returns true when vim consumed the key.
     */
    keydown(face: ComposerEditFace, event: KeyboardEvent): boolean;
}
