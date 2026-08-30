# dsh-plugins

Personal out-of-tree plugins for [dsh](https://github.com/deepseek-ai/deepseek-harness) (DeepSeek Harness), installable through the community plugin flow (`dsh plugin add`).

> **Note:** these plugins require [my fork of DeepSeek Harness](https://github.com/wingillis/deepseek-harness) — they build and run against APIs in the fork, not the upstream `deepseek-ai/deepseek-harness` release.

## Plugins

| Plugin | Description |
|---|---|
| [`dsh-vim-plugin`](./plugins/dsh-vim-plugin/) | Vim modal editing for the Web GUI composer: NORMAL/INSERT/VISUAL modes, a block caret, motions, operators, and a mode badge. |

## Installing a plugin

Each directory under `plugins/` is an installable `dsh` bundle. From a git checkout of this repo:

```sh
dsh plugin --profile web add ./plugins/dsh-vim-plugin
```

or straight from GitHub (see each plugin's README for the `prepare`-script allowance pnpm asks for on git installs):

```sh
dsh plugin --profile web add github:wingillis/dsh-plugins#path:plugins/dsh-vim-plugin
```

## Developing

```sh
pnpm install
pnpm run build   # build every plugin
pnpm test        # test every plugin (some suites need a sibling deepseek-harness checkout)
```

Each plugin builds self-contained (`prepare` runs the same build), so a git install produces working `lib/` output.

## License

MIT
