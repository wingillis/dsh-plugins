import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type VimModeKey } from './locales.ts';
export { VimController } from './controller.ts';
export type { VimMode } from './controller.ts';
export type { VimBadgeInjected, VimToggleInjected } from './slots.ts';
export type { VimModeKey } from './locales.ts';
export type { VimMachineState, VimOp, VimStep, VimDoc, VimKey, VimRegister, VisualState } from './vim/machine.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The vim toggle and mode-badge copy. */
        'vim.mode': VimModeKey;
    }
}
/** Required services: the slot tree, the locale seat, the composer keyboard registry, and the slash-trigger pipeline. */
export declare const inject: string[];
/**
 * Client plugin body: mount the controller, register the keydown
 * interceptor, and contribute both chrome entries.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
