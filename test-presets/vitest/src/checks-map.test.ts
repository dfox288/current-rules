import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { checksMapProblems, globMatches, readRepoFiles, type RepoFiles } from './checks-map.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/checks-map')
const scratch = mkdtempSync(join(tmpdir(), 'checks-map-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A fixture repo: the shared tree plus one case's two files, in a real git repository with everything added. */
function fixtureRepo(name: string): string {
  const root = join(scratch, name)
  cpSync(join(fixtures, 'tree'), root, { recursive: true })
  cpSync(join(fixtures, 'cases', name), root, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  return root
}
const problemsOf = (name: string) => checksMapProblems(readRepoFiles(fixtureRepo(name)))

describe('the shape of checks.map.yml version 2: one fixture repo per rule', () => {
  it('control: the valid repo has no problem, so the cases below are red for their own rule', () => {
    expect(problemsOf('valid')).toEqual([])
  })
  it('a version other than 2', () => {
    expect(problemsOf('version-1')).toEqual(['version is 1, not 2'])
  })
  it('a key is unknown', () => {
    expect(problemsOf('unknown-key')).toEqual(['unknown key rules'])
  })
  it('a kind is missing from checks.kinds.yml', () => {
    expect(problemsOf('kind-missing-from-kinds-file')).toEqual(['kind e2e is missing from checks.kinds.yml'])
  })
  it('an always entry is not a kind', () => {
    expect(problemsOf('always-not-a-kind')).toEqual(['always entry "typecheck" is not a kind'])
  })
  it('a kind has neither always nor paths', () => {
    expect(problemsOf('kind-without-always-or-paths')).toEqual(['kind build has neither always nor paths'])
  })
  it('a glob matches no tracked file', () => {
    expect(problemsOf('glob-matches-no-file')).toEqual(['kind format paths: glob "scripts/**" matches no tracked file'])
  })
  it('a glob is a catch-all', () => {
    expect(problemsOf('glob-catch-all')).toEqual(['kind format paths: glob "**" is a catch-all'])
  })
  it("an edge's tests are not the kind's test files", () => {
    expect(problemsOf('edge-tests-not-kind-tests')).toEqual([
      "kind test edge 0: test/e2e/home.e2e.test.ts is not one of the kind's test files",
    ])
  })
  it('triggers sit on a kind without narrow', () => {
    expect(problemsOf('triggers-without-narrow')).toEqual(['kind test has triggers but no narrow'])
  })
  it('edges sit on a kind without narrow', () => {
    expect(problemsOf('edges-without-narrow')).toEqual(['kind test has edges but no narrow'])
  })
  it('narrow names a step that is not in the table', () => {
    expect(problemsOf('unknown-narrow-step')).toEqual([
      'kind test narrow "pytest-testmon" is not a step of selection.md (vitest-related)',
    ])
  })
})

describe('what the fixture cases do not reach', () => {
  const tracked = ['app/a.ts', 'test/unit/a.test.ts', 'docs/notes.md']
  const kinds = { kinds: { lint: {}, test: {} } }
  const check = (map: unknown, kindsFile: unknown = kinds) => checksMapProblems({ map, kinds: kindsFile, tracked } as RepoFiles)
  const base = { version: 2, always: ['lint'], kinds: { test: { paths: ['app/**'], tests: ['test/unit/*.test.ts'], narrow: 'vitest-related' } } }

  it('control: the base map is clean', () => {
    expect(check(base)).toEqual([])
  })
  it('a file that is not a mapping, and a kinds file without kinds', () => {
    expect(check([])).toEqual(['checks.map.yml is not a mapping'])
    expect(check(undefined)).toEqual(['checks.map.yml is missing or empty'])
    expect(check(base, null)).toEqual(['checks.kinds.yml is missing or empty'])
    expect(check(base, { floors: {} })).toEqual(['checks.kinds.yml has no kinds mapping'])
  })
  it('an unknown key in a kind and in an edge', () => {
    expect(check({ ...base, kinds: { test: { ...base.kinds.test, command: 'x' } } })).toEqual(['kind test has unknown key command'])
    expect(
      check({ ...base, kinds: { test: { ...base.kinds.test, edges: [{ paths: ['docs/notes.md'], tests: ['test/unit/a.test.ts'], run: 'x' }] } } }),
    ).toEqual(['kind test edge 0 has unknown key run'])
  })
  it('lists that are not lists of strings', () => {
    expect(check({ ...base, always: 'lint' })).toEqual(['always is not a list of strings'])
    expect(check({ ...base, notest: [1] })).toEqual(['notest is not a list of strings'])
    expect(check({ ...base, kinds: { test: { paths: true } } })).toEqual(['kind test paths is not a list of strings'])
    expect(check({ ...base, kinds: { test: { ...base.kinds.test, edges: [{ paths: ['app/**'] }] } } })).toEqual(['kind test edge 0 has no tests'])
  })
  it('every list is checked: notest, tests, triggers and the edge lists, not only paths', () => {
    const t = base.kinds.test
    expect(check({ ...base, notest: ['nothing/**'] })).toEqual(['notest: glob "nothing/**" matches no tracked file'])
    expect(check({ ...base, kinds: { test: { ...t, tests: ['nothing/*.ts'] } } })).toEqual(['kind test tests: glob "nothing/*.ts" matches no tracked file'])
    expect(check({ ...base, kinds: { test: { ...t, triggers: ['nothing'] } } })).toEqual(['kind test triggers: glob "nothing" matches no tracked file'])
    expect(
      check({ ...base, kinds: { test: { ...t, edges: [{ paths: ['nothing'], tests: ['test/unit/a.test.ts'] }, { paths: ['docs/notes.md'], tests: ['nowhere.test.ts'] }] } } }),
    ).toEqual(['kind test edge 0 paths: glob "nothing" matches no tracked file', 'kind test edge 1 tests: glob "nowhere.test.ts" matches no tracked file'])
  })
  it('catch-alls in every spelling', () => {
    for (const glob of ['*', '**', '/**', '**/*', '/*', '*/**'])
      expect(check({ ...base, notest: [glob] }), glob).toEqual([`notest: glob "${glob}" is a catch-all`])
  })
  it('a narrow kind without tests cannot own an edge test file', () => {
    const t = { paths: ['app/**'], narrow: 'vitest-related', edges: [{ paths: ['docs/notes.md'], tests: ['test/unit/a.test.ts'] }] }
    expect(check({ ...base, kinds: { test: t } })).toEqual(["kind test edge 0: test/unit/a.test.ts is not one of the kind's test files"])
  })
  it('a kind that is in the kinds file but neither in always nor in the map is reported', () => {
    expect(check({ version: 2, always: [], kinds: { test: base.kinds.test } })).toEqual(['kind lint has neither always nor paths'])
  })
})

describe('globs are gitignore syntax from the repo root', () => {
  it('matches the way the selection reads them', () => {
    expect(globMatches('*.md', 'web/DEPLOY-NOTES.md')).toBe(true)
    expect(globMatches('docs/**', 'docs/brand/mark.svg')).toBe(true)
    expect(globMatches('/test-floors.json', 'test-floors.json')).toBe(true)
    expect(globMatches('/test-floors.json', 'web/test-floors.json')).toBe(false)
    expect(globMatches('tests/**/test_*.py', 'tests/a/b/test_cli.py')).toBe(true)
    expect(globMatches('tests/test_*.py', 'web/test/test_cli.py')).toBe(false)
    expect(globMatches('web/app/**/*.vue', 'web/app/pages/projects/[id]/index.vue')).toBe(true)
    expect(globMatches('src/lookout/worker', 'src/lookout/worker/schema/0001_arrivals.sql')).toBe(true)
    expect(globMatches('web/test/nuxt/*.test.ts', 'web/test/nuxt/deeper/x.test.ts')).toBe(false)
  })
})
