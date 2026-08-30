import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { VimBadgeInjected } from './slots.ts';
/** Full badge props. */
export type VimBadgeProps = InjectFace<VimBadgeInjected> & PropsLocale<'vim.mode'>;
/**
 * Render the mode badge and block-caret overlay entry.
 * @param props - injected face (enabled and mode hooks); `t` rides the locale seat.
 * @returns the overlay while vim is enabled; null otherwise.
 */
export declare function VimBadge({ useEnabled, useMode, t }: VimBadgeProps): import("react").JSX.Element | null;
