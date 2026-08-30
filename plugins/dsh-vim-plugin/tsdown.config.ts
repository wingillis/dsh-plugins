/**
 * Standalone build for the dsh-vim-plugin package, adapted from the
 * deepseek-harness client preset (packages/client/tsdown.client.ts) so this
 * repo builds without the harness monorepo.
 *
 * Two artifacts:
 * - the Node half (lib/index.js, lib/invariant.js) the dsh Loader imports;
 * - the browser bundle (lib/client.js), a closure factory registered through
 *   window.__ModuleLoader__.load() whose externals resolve against the frozen
 *   module table the dsh web shell seeds. CSS Modules compile to hashed class
 *   maps with a self-injecting <style> tag at factory execution.
 */
import { readFile } from 'node:fs/promises'
import { basename, resolve as resolvePath, dirname } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PACKAGE_ID = 'dsh-vim-plugin'

/**
 * The module specifiers the dsh web shell seeds into the frozen module table
 * (PLATFORM_MODULES in @deepseek-ai/dsh-client-web/src/platform.ts). These
 * stay external in the client bundle; every other import inlines.
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

const IS_PLATFORM_MODULE = (specifier: string): boolean =>
  (PLATFORM_MODULES as readonly string[]).includes(specifier)

/** Node-half externals: the production sections a real install puts on disk. */
const NODE_EXTERNALS = [/^@deepseek-ai\//, /^clsx($|\/)/]

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Emit one plugin-owned style injector with a CSS Modules class map export. */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/** Resolve an emitted/imported CSS path against this package's sources. */
function sourceAssetPath(source: string, importer: string): string {
  return resolvePath(dirname(importer), source)
}

/** Node half: the host plugin body and the invariant companion. */
const nodeConfig: UserConfig = {
  name: PACKAGE_ID,
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => NODE_EXTERNALS.some((pattern) => pattern.test(specifier)),
  },
}

/** Browser half: the ModuleLoader closure factory served under /plugins. */
const clientConfig: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: IS_PLATFORM_MODULE,
    alwaysBundle: (specifier: string) => !IS_PLATFORM_MODULE(specifier),
  },
  inputOptions: {
    resolve: {
      conditionNames: [
        (process.env.NODE_ENV ?? 'production') === 'development' ? 'development' : 'production',
        'browser', 'import', 'module', 'default',
      ],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    // Bundle purity gate: a non-baseline @deepseek-ai value import has no
    // module-table supplier — fail the build instead of shipping a require()
    // the loader cannot answer (type-only imports never reach this gate).
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (IS_PLATFORM_MODULE(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a seeded platform module — `
        + 'cross-plugin value imports are forbidden; use cordis services or slots',
      )
    },
  }, {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      const exportEntries = Object.entries(cssExports ?? {})
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      for (const [local, exp] of exportEntries) classMap[local] = exp.name
      return styleInjectionModule(PACKAGE_ID, fileId, code.toString(), classMap)
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

const config: UserConfig[] = process.env.DSH_BUILD_CLIENT_ONLY === 'true'
  ? [clientConfig]
  : [nodeConfig, clientConfig]

export default config
