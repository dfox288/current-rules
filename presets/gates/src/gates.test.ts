import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { judgeTier, protectedLines, raiseFloors, tierCommand, type GateResult, type RunSummary } from './gates.ts'

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
  assert.deepEqual(tierCommand({ stack: 'vitest' }, 'small').slice(-2), ['--tags-filter', '!medium'])
  assert.deepEqual(tierCommand({ stack: 'vitest' }, 'large').slice(-2), ['--project', 'e2e'])
  assert.deepEqual(tierCommand({ stack: 'pytest' }, 'medium').slice(-2), ['-m', 'medium'])
  assert.deepEqual(tierCommand({ stack: 'pytest' }, 'small').slice(-2), ['-m', 'not medium and not large'])
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
