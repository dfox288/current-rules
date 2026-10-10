import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mkdirSync } from 'node:fs'
import { combinedRun, judgeTier, protectedLines, raiseFloors, mergeSummaries, tierCommands, tierExit, tierRuns, narrowingFor, repoPaths, UsageError, type GateResult, type RunSummary } from './gates.ts'

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

// Small and medium in one Vitest process (the units are collected once; the counts are split by the preset's tiers).
const SMALL_MEDIUM = ['pnpm', 'exec', 'vitest', 'run', '--project', 'unit', '--project', 'nuxt']

test('combined: small and medium of a Vitest repo are one `vitest run` over unit and nuxt, with no tag filter', () => {
  assert.deepEqual(combinedRun({ stack: 'vitest' }, undefined), SMALL_MEDIUM)
  assert.deepEqual(combinedRun({ stack: 'vitest', projects: { smallMedium: ['web'] } }, undefined), ['pnpm', 'exec', 'vitest', 'run', '--project', 'web'])
})

test('combined: not for pytest, a repo\'s own tier command, or projects it does not have', () => {
  assert.equal(combinedRun({ stack: 'pytest' }, undefined), undefined)
  assert.equal(combinedRun({ stack: 'vitest', commands: { small: ['x'] } }, undefined), undefined)
  assert.equal(combinedRun({ stack: 'vitest', commands: { medium: ['x'] } }, undefined), undefined)
  assert.equal(combinedRun({ stack: 'vitest', projects: { smallMedium: [] } }, undefined), undefined)
})

test('combined: a narrowing both tiers share is one run; related files make it `vitest related --run`', () => {
  const both = { tests: { small: ['/r/a.test.ts'], medium: ['/r/a.test.ts'] } }
  assert.deepEqual(combinedRun({ stack: 'vitest' }, both), [...SMALL_MEDIUM, '--passWithNoTests', '/r/a.test.ts'])
  const related = { related: ['/r/app/x.ts'], tests: { small: ['/r/a.test.ts'], medium: ['/r/a.test.ts'] } }
  assert.deepEqual(combinedRun({ stack: 'vitest' }, related), ['pnpm', 'exec', 'vitest', 'related', '--run', '--project', 'unit', '--project', 'nuxt', '--passWithNoTests', '/r/app/x.ts', '/r/a.test.ts'])
})

test('combined: tiers narrowed to different files cannot share a run', () => {
  assert.equal(combinedRun({ stack: 'vitest' }, { tests: { small: ['/r/a.test.ts'] } }), undefined)
  assert.equal(combinedRun({ stack: 'vitest' }, { tests: { small: ['/r/a.test.ts'], medium: ['/r/b.test.ts'] } }), undefined)
})

const tiered = (failed: Partial<Record<'small' | 'medium' | 'large', number | undefined>>, extra: Partial<RunSummary> = {}): RunSummary => ({
  ...summary(5, 5),
  tiers: {
    small: { files: 1, tests: 5, failed: failed.small },
    medium: { files: 1, tests: 5, failed: failed.medium },
    large: { files: 0, tests: 0, failed: failed.large },
  },
  ...extra,
})

test('combined: a failure is the tier whose test failed; the other tier of the same run stays green', () => {
  const s = tiered({ small: 0, medium: 2 })
  assert.equal(tierExit(s, 'medium', 1), 1)
  assert.equal(tierExit(s, 'small', 1), 0)
})

test('combined: a red exit no test explains (a file that fails to load, an unhandled error) is red in both tiers', () => {
  const s = tiered({ small: 0, medium: 0 })
  assert.equal(tierExit(s, 'small', 1), 1)
  assert.equal(tierExit(s, 'medium', 1), 1)
})

test('combined: a limit or retry breach named for a tier is that tier\'s even when no test failed there', () => {
  const s = tiered({ small: 0, medium: 1 }, { limitRaised: ['a.test.ts > x (small tier, 60000 ms > 5000 ms)'] })
  assert.equal(tierExit(s, 'small', 1), 1)
})

test('combined: a green exit is green everywhere; a summary from an older preset (no per-tier failures) cannot attribute, so it is red', () => {
  assert.equal(tierExit(tiered({ small: 1 }), 'medium', 0), 0)
  assert.equal(tierExit(tiered({ small: undefined, medium: undefined }), 'small', 1), 1)
  assert.equal(tierExit(undefined, 'small', 1), 1)
})

// The narrowed run (selection.md, rules 5 and 6): the caller names the files, the gate runs those and nothing else.
const R = '/r'
const cmd = (runs: { argv: string[] }[]) => runs.map((r) => r.argv.join(' '))

test('related: the small and medium runs of a Vitest kind become `vitest related --run <files>`', () => {
  const narrowing = { related: [`${R}/app/a.ts`, `${R}/app/b.vue`], tests: { small: [`${R}/test/unit/x.test.ts`], medium: [`${R}/test/unit/x.test.ts`] } }
  const small = tierRuns({ stack: 'vitest' }, 'small', narrowing)
  assert.equal(small.length, 1)
  assert.equal(
    small[0].argv.join(' '),
    'pnpm exec vitest related --run --project unit --tags-filter !medium --passWithNoTests /r/app/a.ts /r/app/b.vue /r/test/unit/x.test.ts',
  )
  const medium = tierRuns({ stack: 'vitest' }, 'medium', narrowing)
  assert.equal(medium.length, 2, 'the nuxt project is its own run')
  assert.ok(cmd(medium).every((c) => c.startsWith('pnpm exec vitest related --run ') && c.endsWith('/r/app/a.ts /r/app/b.vue /r/test/unit/x.test.ts')))
  assert.ok(cmd(medium).some((c) => c.includes('--project nuxt')) && cmd(medium).some((c) => c.includes('--tags-filter medium')))
})

test('related: the same changed file and test file are handed over once', () => {
  const runs = tierRuns({ stack: 'vitest' }, 'small', { related: [`${R}/app/a.ts`, `${R}/t.test.ts`], tests: { small: [`${R}/t.test.ts`] } })
  assert.equal(runs[0].argv.filter((a) => a === '/r/t.test.ts').length, 1)
})

test('related never narrows the large tier: e2e has no narrowing step', () => {
  assert.deepEqual(tierRuns({ stack: 'vitest' }, 'large', { related: [`${R}/app/a.ts`] }), tierRuns({ stack: 'vitest' }, 'large'))
})

test('test paths alone run those files in the tier, as `vitest run`, per tier', () => {
  const narrowing = { tests: { small: [`${R}/test/unit/a.test.ts`], large: [`${R}/test/e2e/z.e2e.test.ts`] } }
  assert.equal(
    cmd(tierRuns({ stack: 'vitest' }, 'small', narrowing))[0],
    'pnpm exec vitest run --project unit --tags-filter !medium --passWithNoTests /r/test/unit/a.test.ts',
  )
  assert.equal(
    cmd(tierRuns({ stack: 'vitest' }, 'large', narrowing))[0],
    'pnpm exec vitest run --project e2e --passWithNoTests /r/test/e2e/z.e2e.test.ts',
  )
  assert.deepEqual(tierRuns({ stack: 'vitest' }, 'medium', narrowing), tierRuns({ stack: 'vitest' }, 'medium'), 'a tier without paths runs whole')
})

test('pytest: test paths are appended to the tier run; there is no related step', () => {
  assert.equal(
    cmd(tierRuns({ stack: 'pytest' }, 'small', { tests: { small: [`${R}/tests/test_a.py`] } }))[0],
    'uv run --group test pytest -m not medium and not large /r/tests/test_a.py',
  )
  assert.throws(() => tierRuns({ stack: 'pytest' }, 'small', { related: [`${R}/src/a.py`] }), (e) => e instanceof UsageError && /pytest has no narrowing step/.test(e.message))
})

test('a tier command of the repo\'s own takes the test paths and refuses related', () => {
  const config = { stack: 'vitest' as const, commands: { small: ['node', 'run-small.mjs'] } }
  assert.equal(cmd(tierRuns(config, 'small', { tests: { small: [`${R}/t.test.ts`] } }))[0], 'node run-small.mjs /r/t.test.ts')
  assert.throws(() => tierRuns(config, 'small', { related: [`${R}/a.ts`] }), (e) => e instanceof UsageError && /commands\.small/.test(e.message))
})

test('narrowingFor: a tier is narrowed by its own test paths, or by related unless it is large', () => {
  assert.equal(narrowingFor(undefined, 'small'), undefined)
  assert.equal(narrowingFor({}, 'small'), undefined)
  assert.deepEqual(narrowingFor({ related: ['/r/a.ts'] }, 'medium'), { related: ['/r/a.ts'], tests: [] })
  assert.equal(narrowingFor({ related: ['/r/a.ts'] }, 'large'), undefined)
  assert.deepEqual(narrowingFor({ tests: { large: ['/r/e.e2e.test.ts'] } }, 'large'), { related: [], tests: ['/r/e.e2e.test.ts'] })
  assert.equal(narrowingFor({ tests: { small: ['/r/a.test.ts'] } }, 'medium'), undefined)
})

test('a narrowed tier is judged on what ran: no floor, and zero tests is a skip, not a failure', () => {
  assert.equal(judgeTier('small', 0, summary(1), { small: 400 }, true).failure, undefined)
  assert.match(judgeTier('small', 0, summary(1), { small: 400 }, true).detail, /narrowed, floor not checked/)
  const none = judgeTier('small', 0, summary(0), { small: 400 }, true)
  assert.equal(none.failure, undefined)
  assert.match(none.skip ?? '', /no small test is related to the selected files/)
})

test('a narrowed tier is still red on a non-zero exit and on a missing summary', () => {
  assert.equal(judgeTier('small', 1, summary(1), {}, true).failure, 'exit 1')
  assert.match(judgeTier('small', 0, undefined, {}, true).failure ?? '', /NOT MEASURED/)
})

test('a whole tier is judged as before: zero tests is red and the floor holds', () => {
  assert.match(judgeTier('small', 0, summary(0), {}, false).failure ?? '', /ran zero small tests/)
  assert.match(judgeTier('small', 0, summary(1), { small: 4 }, false).failure ?? '', /below the floor of 4/)
})

test('repoPaths: paths are relative to the gate\'s directory and come back absolute', () => {
  const root = mkdtempSync(join(tmpdir(), 'gates-paths-'))
  mkdirSync(join(root, 'test'))
  writeFileSync(join(root, 'test/a.test.ts'), '')
  assert.deepEqual(repoPaths(root, ['test/a.test.ts', 'test/a.test.ts'], { mustExist: true }), [join(root, 'test/a.test.ts')])
})

test('repoPaths: a test path that does not exist, or lies outside the gate\'s directory, is a usage error', () => {
  const root = mkdtempSync(join(tmpdir(), 'gates-paths-'))
  assert.throws(() => repoPaths(root, ['test/missing.test.ts'], { mustExist: true }), (e) => e instanceof UsageError && /test\/missing\.test\.ts does not exist/.test(e.message))
  assert.throws(() => repoPaths(root, ['../other/a.test.ts'], { within: root }), (e) => e instanceof UsageError && /outside/.test(e.message))
  assert.deepEqual(repoPaths(root, ['../other/a.py']), [join(root, '../other/a.py')].map((p) => join(p)), 'a related file outside is handed over as it is')
})

const withUnhandled = (n: number | undefined, files = 0): RunSummary => ({ ...summary(files), files, unhandledErrors: n })

test('a run that executed no file and hit an unhandled error is red, narrowed or not, whatever the exit code', () => {
  for (const narrowed of [false, true])
    assert.match(judgeTier('small', 0, withUnhandled(1), {}, narrowed).failure ?? '', /executed 0 files and hit 1 unhandled error/)
})

test('control: no file and no error stays a narrowed skip; an older preset (no count) is read as no error', () => {
  assert.equal(judgeTier('small', 0, withUnhandled(0), {}, true).failure, undefined)
  assert.match(judgeTier('small', 0, withUnhandled(0), {}, true).skip ?? '', /no small test is related/)
  assert.equal(judgeTier('small', 0, withUnhandled(undefined), {}, true).failure, undefined)
})

test('control: a run that executed files is judged by the exit code and the floor, as before', () => {
  assert.equal(judgeTier('small', 0, withUnhandled(2, 3), {}).failure, undefined)
})

test('merged summaries add up their unhandled errors; one from an older preset counts as none', () => {
  assert.equal(mergeSummaries([withUnhandled(1), withUnhandled(2)]).unhandledErrors, 3)
  assert.equal(mergeSummaries([withUnhandled(1), withUnhandled(undefined)]).unhandledErrors, 1)
})
