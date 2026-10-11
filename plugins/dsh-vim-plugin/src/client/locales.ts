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
  'command.description': '切换 Vim 编辑（当前：{state}）',
  'command.state.enabled': '已启用',
  'command.state.disabled': '已停用',
  'command.attachmentsUnsupported': '附件不能伴随 /vim 命令提交',
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
  'command.description': 'Toggle Vim editing (currently: {state})',
  'command.state.enabled': 'enabled',
  'command.state.disabled': 'disabled',
  'command.attachmentsUnsupported': 'Attachments cannot accompany the /vim command',
} satisfies Record<VimModeKey, string>
