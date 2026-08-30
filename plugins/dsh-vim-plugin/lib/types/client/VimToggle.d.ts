import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { VimToggleInjected } from './slots.ts';
/** Full toggle props. */
export type VimToggleProps = InjectFace<VimToggleInjected> & PropsLocale<'vim.mode'>;
/**
 * Render the tool-row toggle entry.
 * @param props - injected face (hooks and the toggle route); `t` rides the locale seat.
 * @returns the toggle button.
 */
export declare function VimToggle({ useEnabled, toggle, t }: VimToggleProps): import("react").JSX.Element;
