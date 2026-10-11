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
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
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

/** Recorded inputTriggers stand-in: collects the sources plugins register. */
function fakeInputTriggers() {
  const sources: InputTriggerSource[] = []
  return {
    sources,
    registerSource(source: InputTriggerSource): () => void {
      sources.push(source)
      return () => {
        const at = sources.indexOf(source)
        if (at >= 0) sources.splice(at, 1)
      }
    },
  }
}

/** Sessions stand-in: hands back one session scope whose bail calls record. */
function fakeSessions() {
  const bails: Array<{ channel: string, args: unknown }> = []
  const scopeCtx = { bail: (_self: unknown, channel: string, args: unknown) => { bails.push({ channel, args }) } }
  return { bails, scope: () => scopeCtx }
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
  const inputTriggers = fakeInputTriggers()
  ctx.provide('inputTriggers', inputTriggers)
  const sessions = fakeSessions()
  ctx.provide('sessions', sessions)
  return { ctx, slots, locale, registry, inputTriggers, sessions }
}

describe('apply', () => {
  it('declares the slot, locale, composerKeys, inputTriggers, and sessions dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'composerKeys', 'inputTriggers', 'sessions'])
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

  it('registers the /vim source: a menu row that toggles, a bare enter that toggles and consumes', async () => {
    const { ctx, inputTriggers, sessions, registry } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(inputTriggers.sources).toHaveLength(1)
    const source = inputTriggers.sources[0]!
    expect(source.trigger).toBe('/')
    expect(source.name).toBe('vim')
    expect(source.showGroupTitle).toBe(false)

    const interceptor = registry.interceptors[0]!
    const session = { sessionId: 's1' } as never

    // The menu row names the switch it flips, with the live state baked in.
    const rows = await source.candidates(session, {
      query: '', position: 'leading', drilled: false, signal: new AbortController().signal,
    })
    expect(rows).toEqual([{ name: 'vim', description: '切换 Vim 编辑（当前：已停用）' }])

    // A menu pick toggles and clears the token (the empty text substitutes
    // the picked span).
    expect(source.onPick({
      candidate: rows[0]!, session, position: 'leading', via: 'menu', action: 'pick',
      span: { start: 0, end: 4 } as never,
    })).toEqual({ text: '' })
    expect(interceptor.keydown(face('abc', 1), keyEvent('Escape'))).toBe(true)

    // A bare enter toggles back, consumes the token on the session scope,
    // and reports handled (the line never sinks as a message).
    const outcome = await source.matchEnter!(session, '/vim', new AbortController().signal, { attachments: 0 })
    expect(outcome).toBe('handled')
    expect(interceptor.keydown(face('abc', 1), keyEvent('Escape'))).toBe(false)
    expect(sessions.bails).toEqual([{
      channel: 'slash/input-consume-token',
      args: { guard: { kind: 'bare-token', token: '/vim' } },
    }])

    // Non-bare lines and other commands pass through untouched.
    expect(await source.matchEnter!(session, '/vim extra', new AbortController().signal, { attachments: 0 })).toBeUndefined()
    expect(await source.matchEnter!(session, '/other', new AbortController().signal, { attachments: 0 })).toBeUndefined()

    // The candidates row reflects the live switch after the toggles.
    expect((await source.candidates(session, {
      query: '', position: 'leading', drilled: false, signal: new AbortController().signal,
    }))[0]!.description).toBe('切换 Vim 编辑（当前：已停用）')

    // An attachment-carrying submission is refused (the draft and attachments stay).
    await expect(source.matchEnter!(session, '/vim', new AbortController().signal, { attachments: 1 }))
      .rejects.toThrow('附件不能伴随 /vim 命令提交')
  })

  it('fiber teardown removes the chrome entries and the interceptor (HMR safety)', async () => {
    const { ctx, slots, registry, inputTriggers } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.input.left')).toHaveLength(1)
    expect(slots.entries('conversation.input.overlay')).toHaveLength(1)
    expect(registry.interceptors).toHaveLength(1)
    expect(inputTriggers.sources).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries('conversation.input.left')).toHaveLength(0)
    expect(slots.entries('conversation.input.overlay')).toHaveLength(0)
    expect(registry.interceptors).toHaveLength(0)
    expect(inputTriggers.sources).toHaveLength(0)
  })
})
