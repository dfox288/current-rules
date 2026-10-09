// The shape test as a repo runs it: one line importing `dist/checks-map-test.js`, in a repository of its own, through
// a real `vitest run`. Needs `pnpm build` (the test runs the built module, as a repo's install would).
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')
const fixtures = join(pkg, '../fixtures/checks-map')
mkdirSync(join(pkg, '.tmp'), { recursive: true })
const scratch = mkdtempSync(join(pkg, '.tmp/checks-map-run-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A repo with the case's two files, a one-line test file importing the built shape test, run from a folder below the root. */
function run(name: string) {
  const root = join(scratch, name)
  cpSync(join(fixtures, 'tree'), root, { recursive: true })
  cpSync(join(fixtures, 'cases', name), root, { recursive: true })
  mkdirSync(join(root, 'test/unit'), { recursive: true })
  writeFileSync(join(root, 'test/unit/checks-map.test.ts'), `import '${join(pkg, 'dist/checks-map-test.js')}'\n`)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  const r = spawnSync(join(pkg, 'node_modules/.bin/vitest'), ['run', '--root', 'test/unit', 'checks-map'], { cwd: root, encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` }
}

describe('the shape test as a repo runs it', () => {
  it('is green for a valid map', () => {
    const r = run('valid')
    expect(r.out).toMatch(/Tests\s+2 passed \(2\)/)
    expect(r.status).toBe(0)
  })
  it('is red for a fault, and names it', () => {
    const r = run('glob-catch-all')
    expect(r.status).not.toBe(0)
    expect(r.out).toMatch(/kind format paths: glob \\?"\*\*\\?" is a catch-all/)
  })
})
