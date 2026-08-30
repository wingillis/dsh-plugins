/**
 * `vim.mode` namespace dictionaries: the composer toggle and the mode
 * indicator copy.
 */
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    'toggle.label': string;
    'toggle.enable': string;
    'toggle.disable': string;
    'mode.normal': string;
    'mode.insert': string;
    'mode.visual': string;
};
/** The vim.mode namespace key union. */
export type VimModeKey = keyof typeof zh;
/** English dictionary, checked complete against the zh key set. */
export declare const en: {
    'toggle.label': string;
    'toggle.enable': string;
    'toggle.disable': string;
    'mode.normal': string;
    'mode.insert': string;
    'mode.visual': string;
};
