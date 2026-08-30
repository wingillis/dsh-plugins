/** Injected faces of the two conversation chrome entries. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { VimMode } from './controller.ts';
/** Injected business face of the composer tool-row toggle entry. */
export interface VimToggleInjected {
    hooks: {
        /** Persisted master switch bound as useEnabled. */
        enabled: SnapshotStore<boolean>;
        /** Live mode bound as useMode (drives the active treatment, not the label). */
        mode: SnapshotStore<VimMode>;
    };
    /** Flip the master switch. */
    toggle: () => void;
}
/** Injected business face of the composer-card mode badge entry. */
export interface VimBadgeInjected {
    hooks: {
        /** Persisted master switch bound as useEnabled. */
        enabled: SnapshotStore<boolean>;
        /** Live mode bound as useMode. */
        mode: SnapshotStore<VimMode>;
    };
}
