/**
 * Vitest config for dsh-vim-plugin. The shared environment is node; specs
 * that need the DOM carry their own `// @vitest-environment jsdom` pragma.
 *
 * Test resolution mirrors the harness's own vitest setup: every
 * `@deepseek-ai/*` specifier resolves to a deepseek-harness checkout's
 * TypeScript sources (DSH_HARNESS_CHECKOUT, default the sibling directory).
 * The tests then exercise the plugin against the same cordis/React instances
 * and client-package sources the harness itself tests against, and never
 * touch the published ./client exports, which are browser ModuleLoader
 * bundles that cannot execute under Node. Run `pnpm install` in the checkout
 * once before `pnpm test` here.
 */
import { existsSync, readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const harness = process.env.DSH_HARNESS_CHECKOUT
  ?? (existsSync('../../../deepseek-harness/package.json') ? '../../../deepseek-harness' : undefined)

if (harness === undefined) {
  throw new Error('tests need a deepseek-harness checkout: clone it next to dsh-plugins (or set DSH_HARNESS_CHECKOUT)')
}

const pkg = (path: string): string => resolvePath(harness, path)

/** Map every harness workspace package name to its src directory. */
const sources = new Map<string, string>()
for (const manifestPath of globSync('packages/*/*/package.json', { cwd: harness })) {
  const manifest = JSON.parse(readFileSync(pkg(manifestPath), 'utf8')) as { name?: string }
  if (manifest.name !== undefined) sources.set(manifest.name, pkg(manifestPath.replace('package.json', 'src')))
}

/**
 * Resolve one @deepseek-ai specifier against the harness sources: the package
 * entry, a `/client` subpath, an explicit `/src/*` path, or a
 * file-or-directory subpath (`/types`, `/display`, ...).
 */
function harnessSource(specifier: string): string | undefined {
  if (specifier === '@deepseek-ai/cordis') return pkg('vendor/cordis/src/index.ts')
  if (!specifier.startsWith('@deepseek-ai/')) return undefined
  const [, name, ...rest] = specifier.split('/')
  const base = sources.get(`@deepseek-ai/${name}`)
  if (base === undefined) return undefined
  const candidate = (...segments: string[]): string | undefined =>
    segments.length > 0 && existsSync(resolvePath(base, ...segments)) ? resolvePath(base, ...segments) : undefined
  if (rest.length === 0) return candidate('index.ts') ?? candidate('index.tsx')
  if (rest[0] === 'src') return resolvePath(base, ...rest.slice(1))
  const sub = rest.join('/')
  return candidate(`${sub}.ts`) ?? candidate(`${sub}.tsx`) ?? candidate(sub, 'index.ts')
}


export default defineConfig({
  plugins: [{
    name: 'dsh-harness-source-resolution',
    enforce: 'pre',
    resolveId(source: string) {
      const mapped = harnessSource(source)
      return mapped ?? null
    },
  }],
  resolve: {
    alias: [
      { find: /^dsh-vim-plugin\/client$/, replacement: fileURLToPath(new URL('./src/client/index.ts', import.meta.url)) },
      { find: /^react$/, replacement: fileURLToPath(new URL('./node_modules/react/index.js', import.meta.url)) },
      { find: /^react\/(.+)$/, replacement: fileURLToPath(new URL(`./node_modules/react/$1.js`, import.meta.url)) },
      { find: /^react-dom$/, replacement: fileURLToPath(new URL('./node_modules/react-dom/index.js', import.meta.url)) },
      { find: /^react-dom\/(.+)$/, replacement: fileURLToPath(new URL(`./node_modules/react-dom/$1.js`, import.meta.url)) },
      // This package's own copy, so its native require('react') resolves the
      // same React instance as everything else instead of the harness's.
      { find: /^use-sync-external-store\/shim\/with-selector$/, replacement: fileURLToPath(new URL('./node_modules/use-sync-external-store/shim/with-selector.js', import.meta.url)) },
      { find: /^use-sync-external-store\/shim$/, replacement: fileURLToPath(new URL('./node_modules/use-sync-external-store/shim.js', import.meta.url)) },
    ],
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})
