/**
 * apply wiring on a real cordis Context + SlotRegistry: the interceptor rides
 * ctx.composerKeys with the plugin fiber (HMR-safe disposal), both chrome
 * entries register into their declared slots, and the injected faces route
 * back into the one controller.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from 'dsh-vim-plugin/client'
import type { ComposerEditFace } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { VimBadgeInjected, VimToggleInjected } from 'dsh-vim-plugin/client'

/** Recorded composerKeys registry stand-in. */
function fakeRegistry() {
  const interceptors: Array<{ keydown: (face: ComposerEditFace, event: KeyboardEvent) => boolean }> = []
  const disposers: Array<() => void> = []
  return {
    interceptors,
    register(interceptor: (typeof interceptors)[number]): () => void {
      interceptors.push(interceptor)
      const disposer = (): void => {
        const at = interceptors.indexOf(interceptor)
        if (at >= 0) interceptors.splice(at, 1)
      }
      disposers.push(disposer)
      return disposer
    },
    notify(): boolean { return false },
  }
}

/** Minimal editing-face stand-in (the interceptor folds through the machine). */
function face(text: string, caret: number): ComposerEditFace {
  const state = { text, caret }
  return {
    text: () => state.text,
    caret: () => state.caret,
    selection: () => null,
    moveTo: (to) => { state.caret = to; return true },
    selectRange: () => true,
    replaceRange: (start, end, replacement) => {
      state.text = state.text.slice(0, start) + replacement + state.text.slice(end)
      return true
    },
    insertBreak: (at) => {
      state.text = state.text.slice(0, at) + '\n' + state.text.slice(at)
      return true
    },
    undo: () => {},
  }
}

function keyEvent(key: string): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    {
      name: 'root',
      children: {
        'conversation.input.left': { kind: 'list', scope: 'session' },
        'conversation.input.overlay': { kind: 'list', scope: 'session' },
      },
    } as never,
    () => null,
  )
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const registry = fakeRegistry()
  ctx.provide('composerKeys', registry)
  return { ctx, slots, locale, registry }
}

describe('apply', () => {
  it('declares the slot, locale, and composerKeys dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'composerKeys'])
  })

  it('registers the bilingual dictionaries and both chrome entries', async () => {
    const { ctx, slots, locale } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const t = locale.bind('vim.mode')
    expect(t('toggle.label')).toBe('Vim')
    expect(t('mode.normal')).toBe('NORMAL')
    locale.setLocale('en')
    expect(t('toggle.enable')).toBe('Enable Vim editing')

    const toggleEntry = slots.entries('conversation.input.left')[0]
    expect(toggleEntry?.options.id).toBe('vim-toggle')
    expect(toggleEntry?.locale).toBe('vim.mode')
    const badgeEntry = slots.entries('conversation.input.overlay')[0]
    expect(badgeEntry?.options.id).toBe('vim-badge')
    // Both injected faces route back into the one controller's stores.
    const badgeInject = badgeEntry!.inject as unknown as () => VimBadgeInjected
    expect(badgeInject().hooks.mode.getSnapshot()).toBe('insert')
  })

  it('registers the keydown interceptor; the injected toggle routes into the controller', async () => {
    const { ctx, registry, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(registry.interceptors).toHaveLength(1)
    const interceptor = registry.interceptors[0]!
    // Disabled by default: keys pass untouched.
    expect(interceptor.keydown(face('abc', 1), keyEvent('Escape'))).toBe(false)

    const toggleEntry = slots.entries('conversation.input.left')[0]
    // StoredEntry.inject is declaration-typed; the erased registration
    // widens it past a direct cast, so hop unknown (same as the
    // ui-input-trigger apply spec).
    const injectEntry = toggleEntry!.inject as unknown as () => VimToggleInjected
    const injected = injectEntry()
    injected.toggle()
    expect(interceptor.keydown(face('abc', 1), keyEvent('Escape'))).toBe(true)
  })

  it('fiber teardown removes the chrome entries and the interceptor (HMR safety)', async () => {
    const { ctx, slots, registry } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.input.left')).toHaveLength(1)
    expect(slots.entries('conversation.input.overlay')).toHaveLength(1)
    expect(registry.interceptors).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries('conversation.input.left')).toHaveLength(0)
    expect(slots.entries('conversation.input.overlay')).toHaveLength(0)
    expect(registry.interceptors).toHaveLength(0)
  })
})
