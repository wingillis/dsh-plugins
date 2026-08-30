/**
 * `vim.mode` namespace dictionaries: the composer toggle and the mode
 * indicator copy.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'toggle.label': 'Vim',
  'toggle.enable': '启用 Vim 编辑',
  'toggle.disable': '停用 Vim 编辑',
  'mode.normal': 'NORMAL',
  'mode.insert': 'INSERT',
  'mode.visual': 'VISUAL',
} satisfies Record<string, string>

/** The vim.mode namespace key union. */
export type VimModeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'toggle.label': 'Vim',
  'toggle.enable': 'Enable Vim editing',
  'toggle.disable': 'Disable Vim editing',
  'mode.normal': 'NORMAL',
  'mode.insert': 'INSERT',
  'mode.visual': 'VISUAL',
} satisfies Record<VimModeKey, string>
