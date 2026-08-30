/**
 * Vim mode plugin, browser half: one VimController mounted in apply — the
 * ComposerKeysService interceptor folds composer keydowns through the pure
 * machine, the tool-row toggle flips the persisted master switch, and the
 * overlay badge renders the NORMAL mode line.
 */
// Type-only: service and slot declaration merges consumed by this plugin.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { VimController } from './controller.ts'
import { VimBadge } from './VimBadge.tsx'
import { VimToggle } from './VimToggle.tsx'
import { en, zh, type VimModeKey } from './locales.ts'
import type { VimBadgeInjected, VimToggleInjected } from './slots.ts'

export { VimController } from './controller.ts'
export type { VimMode } from './controller.ts'
export type { VimBadgeInjected, VimToggleInjected } from './slots.ts'
export type { VimModeKey } from './locales.ts'
export type { VimMachineState, VimOp, VimStep, VimDoc, VimKey, VimRegister, VisualState } from './vim/machine.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The vim toggle and mode-badge copy. */
    'vim.mode': VimModeKey
  }
}

/** Namespace owning the toggle and badge copy. */
const VIM_NS = 'vim.mode'

/** Required services: the slot tree, the locale seat, and the composer keyboard registry. */
export const inject = ['slots', 'locale', 'composerKeys']

/**
 * Client plugin body: mount the controller, register the keydown
 * interceptor, and contribute both chrome entries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new VimController(false)
  ctx.effect(() => ctx.locale.register(VIM_NS, { zh, en }), 'ui-vim-mode: dictionaries')
  // The registry consults in registration order; the disposer rides the
  // plugin fiber, so unloading the plugin stops the interception.
  ctx.effect(
    () => ctx.composerKeys.register({
      keydown: (face, event) => controller.keydown(face, event),
    }),
    'ui-vim-mode: composer keydown interceptor',
  )
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'vim-toggle',
    order: 40,
    locale: VIM_NS,
    inject: (): VimToggleInjected => ({
      hooks: { enabled: controller.enabled, mode: controller.mode },
      toggle: () => { controller.toggle() },
    }),
  }, VimToggle))
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'vim-badge',
    order: 100,
    locale: VIM_NS,
    inject: (): VimBadgeInjected => ({
      hooks: { enabled: controller.enabled, mode: controller.mode },
    }),
  }, VimBadge))
}
