/**
 * VimController: the plugin's single apply-closure instance. Owns the pure
 * machine state, the persisted enabled preference, and the published mode;
 * `keydown` is the ComposerKeysService interceptor — it folds each keydown
 * through the machine and applies the resulting operations to the session's
 * editing face.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComposerEditFace } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { INITIAL_VIM_STATE, step, type VimMachineState } from './vim/machine.ts'

/** localStorage key of the enabled preference (see client-store persistence). */
const PERSIST_KEY = 'dsh.vim-mode.enabled'

/** Composer editor mode, published for the indicator surfaces. */
export type VimMode = 'insert' | 'normal' | 'visual'

/**
 * The vim mode controller.
 * @param enabledInitial - fallback when no preference is persisted (non-browser runs, first visit).
 */
export class VimController {
  /** Persisted master switch (localStorage; failures only disable persistence). */
  readonly enabled: SnapshotStore<boolean>
  /** Live editor mode (transient; every load starts in insert). */
  readonly mode: SnapshotStore<VimMode>
  private machine: VimMachineState = INITIAL_VIM_STATE

  constructor(enabledInitial: boolean) {
    this.enabled = createSnapshotStore(enabledInitial, { persist: { name: PERSIST_KEY } })
    this.mode = createSnapshotStore<VimMode>('insert')
  }

  /**
   * Turn vim editing on or off; the machine resets so a re-enable starts clean in insert.
   * @param next whether the vim layer should intercept composer keys
   */
  setEnabled(next: boolean): void {
    this.machine = INITIAL_VIM_STATE
    this.mode.set('insert')
    this.enabled.set(next)
  }

  /** The mode an indicator surface should show: visual outranks the underlying normal mode. */
  private publishedMode(state: VimMachineState): VimMode {
    return state.visual !== null ? 'visual' : state.mode
  }

  /** Flip the master switch (the toggle button and badge gesture). */
  toggle(): void {
    this.setEnabled(!this.enabled.getSnapshot())
  }

  /**
   * The ComposerKeysService interceptor: fold one keydown through the machine
   * and apply its operations. Everything runs synchronously inside the
   * keydown, so the editing face's reads observe each applied operation.
   * @param face - the focused session's editing face.
   * @param event - the raw keydown.
   * @returns true when vim consumed the key.
   */
  keydown(face: ComposerEditFace, event: KeyboardEvent): boolean {
    if (!this.enabled.getSnapshot()) return false
    if (event.key === 'Unidentified') return false
    const text = face.text()
    const selection = face.selection()
    const caret = selection === null ? face.caret() ?? text.length : selection.end
    const result = step(this.machine, { text, caret, selection }, {
      key: event.key,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
    })
    if (!result.consume) return false
    for (const op of result.ops) {
      switch (op.type) {
        case 'move': face.moveTo(op.to); break
        case 'select': face.selectRange(op.start, op.end); break
        case 'replace': face.replaceRange(op.start, op.end, op.text); break
        case 'break': face.insertBreak(op.at); break
        case 'undo': face.undo(); break
      }
    }
    this.machine = result.state
    const published = this.publishedMode(result.state)
    if (this.mode.getSnapshot() !== published) this.mode.set(published)
    return true
  }
}
