/**
 * Composer tool-row toggle: the conversation.input.left entry. A compact
 * chip-like button showing the vim master switch (aria-pressed); pressing it
 * flips the persisted preference and resets the machine.
 */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './vim.module.css'
import type { VimToggleInjected } from './slots.ts'

/** Full toggle props. */
export type VimToggleProps = InjectFace<VimToggleInjected> & PropsLocale<'vim.mode'>

/**
 * Render the tool-row toggle entry.
 * @param props - injected face (hooks and the toggle route); `t` rides the locale seat.
 * @returns the toggle button.
 */
export function VimToggle({ useEnabled, toggle, t }: VimToggleProps) {
  const enabled = useEnabled(value => value)
  return (
    <Tooltip label={enabled ? t('toggle.disable') : t('toggle.enable')} side="top" delayMs={500}>
      <button
        type="button"
        className={clsx(css.toggle, enabled && css.active)}
        aria-pressed={enabled}
        aria-label={t('toggle.label')}
        onClick={toggle}
      >
        {t('toggle.label')}
      </button>
    </Tooltip>
  )
}
