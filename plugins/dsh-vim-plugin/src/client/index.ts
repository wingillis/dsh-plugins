/**
 * Vim mode plugin, browser half: one VimController mounted in apply — the
 * ComposerKeysService interceptor folds composer keydowns through the pure
 * machine, the tool-row toggle and the /vim slash command flip the persisted
 * master switch, and the overlay badge renders the NORMAL mode line.
 */
// Type-only: service and slot declaration merges consumed by this plugin.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.inputTriggers merge (the /vim source registers there)
// and the ctx.sessions merge (the bare-enter path consumes the token on the
// session scope).
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
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

/** The bare slash token the vim source owns. */
const VIM_TOKEN = '/vim'

/** Required services: the slot tree, the locale seat, the composer keyboard registry, and the slash-trigger pipeline. */
export const inject = ['slots', 'locale', 'composerKeys', 'inputTriggers', 'sessions']

/**
 * Client plugin body: mount the controller, register the keydown
 * interceptor, and contribute both chrome entries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new VimController(false)
  ctx.effect(() => ctx.locale.register(VIM_NS, { zh, en }), 'ui-vim-mode: dictionaries')
  const t = ctx.locale.bind(VIM_NS)
  // The /vim slash command: one trigger-source row that toggles the master
  // switch in place — a menu pick replaces the '/vim' token with nothing, a
  // bare enter consumes the token through the session's CAS-guarded
  // consume channel. No popup, no second decision; the row, the tool-row
  // chip, and the preference stay one switch.
  const vimSource: InputTriggerSource = {
    trigger: '/',
    name: 'vim',
    // The row rides the shared slash menu without its own group header.
    showGroupTitle: false,
    candidates: async () => [{
      name: 'vim',
      description: t('command.description', {
        state: controller.enabled.getSnapshot() ? t('command.state.enabled') : t('command.state.disabled'),
      }),
    }],
    onPick: (pick) => {
      if (pick.candidate.name !== 'vim') return undefined
      controller.toggle()
      // The pipeline substitutes the picked token's span with this text, so
      // the empty string clears '/vim' from the draft.
      return { text: '' }
    },
    matchEnter: async (session, line, _signal, envelope) => {
      if (line.trim() !== VIM_TOKEN) return undefined
      if (envelope.attachments > 0) throw new Error(t('command.attachmentsUnsupported'))
      controller.toggle()
      // Consume the bare token on the session scope — the same channel the
      // command service uses — so the draft clears; 'handled' keeps the line
      // from sinking as an ordinary message.
      const actx = ctx.sessions.scope(session.sessionId)
      actx?.bail(actx, 'slash/input-consume-token', { guard: { kind: 'bare-token', token: VIM_TOKEN } })
      return 'handled'
    },
  }
  ctx.effect(() => ctx.inputTriggers.registerSource(vimSource), 'ui-vim-mode: /vim source')
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
