import type { Plugin } from 'vitest/config'
import type { Vitest } from 'vitest/node'
import { testPresetReporter } from './reporter.js'

interface RunInternals {
  onAfterSetServer(fn: () => void): void
  reporters: unknown[]
}

const registered = new WeakSet<object>()

const SHAPE_TEST_IMPORT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*import\s*['"]@dfox288\/test-preset-vitest\/checks-map-test['"]\s*;?\s*$/

/**
 * A test file that is only `import '@dfox288/test-preset-vitest/checks-map-test'`, as source an `it` that Vitest's static
 * scan can see: `vitest list` reads the file's own code and a test behind an import is not there ("No test suite found").
 * Anything else comes back undefined.
 */
export function expandShapeTestImport(code: string): string | undefined {
  if (!SHAPE_TEST_IMPORT.test(code)) return undefined
  return [
    `import { it } from 'vitest'`,
    `import { checksMapTest } from '@dfox288/test-preset-vitest/checks-map-body'`,
    `it('checks.map.yml has the shape of version 2 (selection.md)', checksMapTest)`,
    '',
  ].join('\n')
}

/**
 * Adds the preset's reporter once the run's own reporters exist. Every project lists it (Vitest calls
 * `configureVitest` only for the plugins of the projects, not the root's); the first call registers it.
 */
export function testPresetPlugin(): Plugin {
  return {
    name: 'test-preset',
    enforce: 'pre',
    transform(code: string) {
      const expanded = expandShapeTestImport(code)
      return expanded === undefined ? undefined : { code: expanded, map: null }
    },
    configureVitest({ vitest }: { vitest: Vitest }) {
      // The CLI's `--reporter` replaces the config's reporters, so a config-level reporter would
      // vanish exactly when a worker asks for a different output. `onAfterSetServer` and `reporters`
      // are not in Vitest 4.1's typed API; the break-it for the count guard proves they still work.
      if (registered.has(vitest)) return
      registered.add(vitest)
      const run = vitest as unknown as RunInternals
      run.onAfterSetServer(() => {
        run.reporters.push(testPresetReporter)
      })
    },
  } as Plugin
}
