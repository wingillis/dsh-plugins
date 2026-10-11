# dsh-vim-plugin

Vim modal editing for the [dsh](https://github.com/deepseek-ai/deepseek-harness) Web GUI composer, installable as an out-of-tree plugin.

## What you get

A `Vim` chip in the composer tool row flips the master switch, and so does the `/vim` slash command — picking its row from the `/` menu or entering a bare `/vim` toggles vim on/off immediately, no prompt in between; while enabled, `Escape` leaves insert mode for NORMAL mode, where the caret renders as a blinking block over the character it sits on — or, on an empty draft, as a bare-width block at the start of the first line — and motions (`h j k l w b e 0 ^ $ gg G f F t T ; ,`), operators (`d c y` with motions, doubled `dd cc yy`), counts, single-key edits (`x s X D C r p P o O u i I a A`), and one unnamed register work over the draft. `v`/`V` start a visual selection (charwise or linewise) that every motion extends and `d x y c` manipulate. `Enter` submits the prompt in every mode; Tab, function keys, and every Ctrl/Cmd combination keep their browser-owned behavior. While the slash/`@` candidate menu is open, the menu owns the keyboard and vim steps aside entirely.

### Key map

| Group | Keys |
|---|---|
| Mode | `Escape` (insert → normal, backs off one char), `i I a A o O` (normal → insert) |
| Visual | `v` charwise, `V` linewise (repeating the entry key or `Escape` exits; `v`/`V` again switches flavor) |
| Motions | `h j k l`, arrows, `w b e`, `0 ^ $`, `Home End`, `gg G`, `gj gk` (display rows, see below), `f/F/t/T{char}` with `;`/`,` repeats — in visual mode every motion extends the selection |
| Operators | `d c y` + motions (charwise; `j k gg G` linewise), `dd cc yy`; in visual mode `d x` delete, `y` yanks, `c s` change, and `D Y C` act linewise |

## Install

Requires `dsh` `0.2.1-alpha.2` or newer. Install into a profile (the shipped `web` profile or one of your own):

```sh
dsh plugin --profile web add github:wingillis/dsh-plugins#path:plugins/dsh-vim-plugin
```

The first git install asks you to allow the package's `prepare` script — copy the exact key pnpm prints into the profile's `pnpm-workspace.yaml` (it is the full `dsh-vim-plugin@https://codeload...` form, not the bare name), then re-run the `add`. The build is a no-op when `lib/` is committed, so the allowance only replays that check. Alternatively install a prebuilt tarball (no build permission needed):

```sh
pnpm pack && dsh plugin --profile web add ./dsh-vim-plugin-0.2.0.tgz
```

Verify the layer and boot:

```sh
dsh --profile web --dump-config   # shows a "# == dsh-vim-plugin" layer
dsh --profile web
```

## How it works

The vim machine is a pure core over the composer's keyboard-extension seam (`ctx.composerKeys` in `dsh-client-ui-conversation`); the editor itself, its undo history, and every submit gesture stay the composer's own. The package ships a Node half (an empty host `apply` so the Loader row exists) and a browser half declared through `dsh.client`; `dsh-client-modules` serves the built `lib/client.js` under `/plugins/dsh-vim-plugin/client.js` once the row is enabled.

### Known limitations

- **Undo granularity is Lexical's** — the composer's history coalesces rapid consecutive edits (one-second merge window), so `u` may undo more than one vim operation typed in quick succession.
- **Visual selections are inclusive of the cursor character** — exclusive motions (`w`, `b`) include one character more than strict vim; there is no `o` endpoint swap, text objects (`iw`), or visual block mode yet.
- **Marks, search (`/` `?`), `J`, `~`, and dot-repeat are deferred** — the keys are consumed (nothing types) but do nothing yet.
- **Programmatic caret motion does not scroll** — a vim motion in a draft longer than the 14-line composer viewport can move the caret out of view.
- **`gj`/`gk` wrap positions are mirror-measured approximations** — the controller mirrors the focused editor into a hidden offscreen element and reads per-glyph rows, so a chip (mention, file) wraps at its U+FFFC placeholder's width rather than the rendered chip's; when no measurement is possible (or in Node), the motions degrade to logical `j`/`k`.
- **Drag selections are ignored by motions** — a NORMAL-mode motion folds against the selection's focus end and collapses the selection on the next edit.

## Development

```sh
pnpm install
pnpm run build   # tsc declarations + tsdown (lib/index.js, lib/client.js)
pnpm test        # vitest
```

The apply/component specs import `LocaleRuntime` and `SlotRegistry` from the harness's own client sources, because the published packages' `./client` export is a browser bundle that cannot run under Node. Clone [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) next to this repo (or point `DSH_HARNESS_CHECKOUT` at a checkout) and run `pnpm install` there before `pnpm test`.

## License

MIT
