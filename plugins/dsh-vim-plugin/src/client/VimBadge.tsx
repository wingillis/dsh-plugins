/**
 * Composer mode chrome: the conversation.input.overlay entry. While vim
 * editing is enabled and the machine sits in a modal mode it renders the
 * classic mode line (NORMAL, or VISUAL while a selection grows); insert is
 * the composer's native posture and stays unbadge. In NORMAL mode it also
 * renders the block caret — a box over the character under the caret — and
 * suppresses the composer's thin native caret for the same card. Pointer
 * events stay off so the chrome never intercepts composer interaction.
 */
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { computeCaretBlock, composerEditableOf, type CaretBlock } from './blockCursor.ts'
import css from './vim.module.css'
import type { VimBadgeInjected } from './slots.ts'

/** Full badge props. */
export type VimBadgeProps = InjectFace<VimBadgeInjected> & PropsLocale<'vim.mode'>

/**
 * Track the block-caret box while a modal caret owns the card's selection.
 * Re-measured on selection, scroll, resize, and surface-layout changes —
 * every channel that can move the caret's on-screen box.
 * @param anchorRef - the overlay anchor element.
 * @param active - whether the block caret should render.
 * @returns the measured box, or null while there is nothing to cover.
 */
function useCaretBlock(anchorRef: RefObject<HTMLDivElement | null>, active: boolean): CaretBlock | null {
  const [block, setBlock] = useState<CaretBlock | null>(null)
  useEffect(() => {
    if (!active) {
      setBlock(null)
      return
    }
    const measure = (): void => { setBlock(computeCaretBlock(anchorRef.current)) }
    measure()
    document.addEventListener('selectionchange', measure)
    window.addEventListener('resize', measure)
    // Scroll does not bubble, but capture hears every scrollport under the
    // document — including the composer card's draft scrollport.
    document.addEventListener('scroll', measure, true)
    const editable = composerEditableOf(anchorRef.current)
    let observer: ResizeObserver | null = null
    if (editable !== null) {
      observer = new ResizeObserver(measure)
      observer.observe(editable)
    }
    return () => {
      document.removeEventListener('selectionchange', measure)
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
      observer?.disconnect()
    }
  }, [active, anchorRef])
  return block
}

/**
 * Suppress the composer's thin native caret while a modal mode owns the
 * card, so the block caret (or the visual selection) is the only cursor.
 * @param anchorRef - the overlay anchor element.
 * @param modal - whether any modal mode is active.
 */
function useHiddenNativeCaret(anchorRef: RefObject<HTMLDivElement | null>, modal: boolean): void {
  useEffect(() => {
    if (!modal) return
    const editable = composerEditableOf(anchorRef.current)
    if (editable === null) return
    editable.classList.add(css.blockCaret)
    return () => { editable.classList.remove(css.blockCaret) }
  }, [modal, anchorRef])
}

/**
 * Render the mode badge and block-caret overlay entry.
 * @param props - injected face (enabled and mode hooks); `t` rides the locale seat.
 * @returns the overlay while vim is enabled; null otherwise.
 */
export function VimBadge({ useEnabled, useMode, t }: VimBadgeProps) {
  const enabled = useEnabled(value => value)
  const mode = useMode(value => value)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const modal = enabled && mode !== 'insert'
  const block = useCaretBlock(anchorRef, modal && mode === 'normal')
  useHiddenNativeCaret(anchorRef, modal)
  if (!enabled) return null
  return (
    <div ref={anchorRef} className={css.overlay}>
      {modal && (
        <div className={css.badge} role="status" aria-live="polite">
          {mode === 'visual' ? t('mode.visual') : t('mode.normal')}
        </div>
      )}
      {block !== null && (
        <div
          aria-hidden
          className={css.block}
          style={{
            left: `${block.left}px`,
            top: `${block.top}px`,
            width: `${block.width}px`,
            height: `${block.height}px`,
          }}
        />
      )}
    </div>
  )
}
