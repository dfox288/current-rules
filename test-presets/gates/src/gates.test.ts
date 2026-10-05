import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { judgeTier, protectedLines, raiseFloors, mergeSummaries, tierCommands, tierRuns, selectFiles, type GateResult, type RunSummary } from './gates.ts'

const summary = (small: number, medium = 0, large = 0): RunSummary => ({
  files: 1,
  tests: small + medium + large,
  skipped: 0,
  quarantined: 0,
  failed: 0,
  flaky: [],
  retriedBeyondRules: [],
  tiers: {
    small: { files: 1, tests: small },
    medium: { files: 1, tests: medium },
    large: { files: 1, tests: large },
  },
})

test('a tier that ran zero tests fails even when the runner exited 0', () => {
  assert.match(judgeTier('small', 0, summary(0), {}).failure ?? '', /ran zero small tests/)
})

test('a tier below its floor fails', () => {
  assert.match(judgeTier('small', 0, summary(3), { small: 4 }).failure ?? '', /3 small tests is below the floor of 4/)
})

test('a tier at its floor passes', () => {
  assert.equal(judgeTier('small', 0, summary(4), { small: 4 }).failure, undefined)
})

test('a missing summary is not measured, never green', () => {
  assert.match(judgeTier('small', 0, undefined, {}).failure ?? '', /NOT MEASURED/)
})

test('a non-zero exit fails whatever the summary says', () => {
  assert.equal(judgeTier('large', 1, summary(0, 0, 9), {}).failure, 'exit 1')
})

test('floors are raised, never lowered', () => {
  const root = mkdtempSync(join(tmpdir(), 'gates-floors-'))
  const result = (name: 'small' | 'medium', tests: number): GateResult => ({
    name,
    status: 'ok',
    seconds: 0,
    detail: '',
    summary: summary(name === 'small' ? tests : 0, name === 'medium' ? tests : 0),
  })
  raiseFloors(root, { stack: 'vitest' }, { small: 10, medium: 1 }, [result('small', 7), result('medium', 5)])
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'test-floors.json'), 'utf8')), { small: 10, medium: 5 })
})

test('tier selection per stack', () => {
  assert.deepEqual(tierCommands({ stack: 'vitest' }, 'small')[0].slice(-3, -1), ['--tags-filter', '!medium'])
  assert.deepEqual(tierCommands({ stack: 'vitest' }, 'large')[0].slice(-2), ['--project', 'e2e'])
  assert.deepEqual(tierCommands({ stack: 'pytest' }, 'medium')[0].slice(-2), ['-m', 'medium'])
  assert.deepEqual(tierCommands({ stack: 'pytest' }, 'small')[0].slice(-2), ['-m', 'not medium and not large'])
})

const withProtected = (small: number, protectedSmall?: number): RunSummary => {
  const s = summary(small)
  if (protectedSmall !== undefined) s.tiers.small.protected = protectedSmall
  return s
}
const tierResult = (name: 'small' | 'medium' | 'large', s: RunSummary): GateResult => ({
  name,
  status: 'ok',
  seconds: 0,
  detail: '',
  summary: s,
})

test('the protected count is one stable line per tier', () => {
  assert.deepEqual(protectedLines([tierResult('small', withProtected(437, 41))]), ['small: 437 tests, 41 protected'])
})

test('a tier with no protected tests says 0, the line is still there', () => {
  assert.deepEqual(protectedLines([tierResult('small', withProtected(5, 0))]), ['small: 5 tests, 0 protected'])
})

test('a summary from a preset that does not count says so, never 0', () => {
  assert.deepEqual(protectedLines([tierResult('small', withProtected(5))]), [
    'small: 5 tests, protected not reported (preset older than 0.1.3)',
  ])
})

test('a skipped tier and a failed gate without a summary have no line', () => {
  const skipped: GateResult = { name: 'large', status: 'skipped', seconds: 0, detail: '' }
  const lint: GateResult = { name: 'lint', status: 'ok', seconds: 0, detail: '', summary: withProtected(1, 1) }
  assert.deepEqual(protectedLines([skipped, lint]), [])
})

test('floors do not depend on the protected count', () => {
  assert.equal(judgeTier('small', 0, withProtected(4, 0), { small: 4 }).failure, undefined)
})

// Run and count agree: an untagged nuxt test is counted medium, so it must run in the medium pass only.
const flat = (runs: string[][]) => runs.map((r) => r.join(' '))
test('untagged nuxt tests run in the medium pass and not in the small pass', () => {
  const small = flat(tierCommands({ stack: 'vitest' }, 'small'))
  const medium = flat(tierCommands({ stack: 'vitest' }, 'medium'))
  assert.ok(small.every((r) => !r.includes('--project nuxt')), small.join(' | '))
  assert.ok(medium.some((r) => r.includes('--project nuxt') && !r.includes('--tags-filter')), medium.join(' | '))
})
test('control: untagged unit tests run in the small pass, tagged ones in medium', () => {
  assert.ok(flat(tierCommands({ stack: 'vitest' }, 'small')).some((r) => r.includes('--project unit') && r.includes('!medium')))
  assert.ok(flat(tierCommands({ stack: 'vitest' }, 'medium')).some((r) => r.includes('--project unit') && r.includes('--tags-filter medium')))
})

test('a medium tier made of two runs adds up in one summary', () => {
  const merged = mergeSummaries([summary(0, 2), summary(0, 3)])
  assert.equal(merged.tiers.medium.tests, 5)
  assert.equal(merged.tests, 5)
})

// Tier selection by static scan: the medium run of the tag-selected projects gets its files from `vitest list`.
const fake = (stdout: string, code = 0, stderr = '') => [
  process.execPath,
  '-e',
  `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${code})`,
]
const listing = (root: string, files: string[]) =>
  JSON.stringify(files.flatMap((f, i) => [{ name: `t${i}a`, file: join(root, f) }, { name: `t${i}b`, file: join(root, f) }]))

test('only the medium run of the tag-selected projects is selected by a scan; small is not', () => {
  const medium = tierRuns({ stack: 'vitest', projects: { smallMedium: ['unit', 'nuxt'] } }, 'medium')
  assert.equal(medium.length, 2)
  assert.deepEqual(medium[0].list, ['pnpm', 'exec', 'vitest', 'list', '--tags-filter', 'medium', '--project', 'unit', '--json'])
  assert.equal(medium[1].list, undefined, 'the nuxt project runs whole')
  assert.ok(tierRuns({ stack: 'vitest' }, 'small').every((r) => r.list === undefined))
  assert.ok(tierRuns({ stack: 'vitest' }, 'large').every((r) => r.list === undefined))
  assert.equal(tierRuns({ stack: 'pytest' }, 'medium')[0].list, undefined)
  assert.equal(tierRuns({ stack: 'vitest', commands: { medium: ['x'] } }, 'medium')[0].list, undefined)
})

test('control: the scan gives exactly the files of the full collection, once each, sorted', () => {
  const root = mkdtempSync(join(tmpdir(), 'gates-select-'))
  const collected = ['test/b.test.ts', 'test/a.test.ts', 'test/sub/c.test.ts'] // what a full collection finds
  const selected = selectFiles(fake(listing(root, collected)), root)
  assert.ok('files' in selected)
  assert.deepEqual(selected.files, collected.map((f) => join(root, f)).sort())
})

test('a failing list is an error with the reason, never an empty selection', () => {
  const root = mkdtempSync(join(tmpdir(), 'gates-select-'))
  const failed = selectFiles(fake('', 1, 'Error: No projects matched'), root)
  assert.ok('error' in failed)
  assert.match(failed.error, /vitest list failed: exit 1 from .*No projects matched$/s)
  const garbage = selectFiles(fake('not json'), root)
  assert.ok('error' in garbage)
  assert.match(garbage.error, /no JSON/)
  const missing = selectFiles(['/nonexistent/vitest-binary'], root)
  assert.ok('error' in missing)
  assert.match(missing.error, /could not start/)
  const shape = selectFiles(fake('{"a":1}'), root)
  assert.ok('error' in shape)
})

test('a list that finds no file is an empty selection the runner must not turn into a bare run', () => {
  const root = mkdtempSync(join(tmpdir(), 'gates-select-'))
  assert.deepEqual(selectFiles(fake('[]'), root), { files: [] })
})
