import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { judgeTier, raiseFloors, tierCommand, type GateResult, type RunSummary } from './gates.ts'

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
