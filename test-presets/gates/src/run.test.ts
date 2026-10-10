// runGates end to end with a repo's own tier command (`commands`), so no Vitest is needed: the command is a
// small script that writes the run summary the preset's reporter would write.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runGates, type GatesConfig } from './gates.ts'

/** A repo whose small tier is `node tier.mjs`; `body` is that script's source. */
function repo(body: string, config: Partial<GatesConfig> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gates-run-'))
  mkdirSync(join(root, '.tmp'), { recursive: true })
  writeFileSync(join(root, 'tier.mjs'), body)
  return { root, config: { stack: 'vitest', tiers: ['small'], commands: { small: ['node', 'tier.mjs'] }, ...config } as GatesConfig }
}

/** runGates with its console output captured. */
async function run(root: string, config: GatesConfig) {
  const lines: string[] = []
  const log = console.log
  console.log = (...a: unknown[]) => void lines.push(a.join(' '))
  try {
    const result = await runGates(root, config, { only: ['small'] })
    return { result, lines }
  } finally {
    console.log = log
  }
}

const writeSummary = (json: string) =>
  `import { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.TEST_PRESET_SUMMARY, ${json})\n`

test('a corrupt run summary is a red gate with a reason, and the GATE verdict line is still printed', async () => {
  const { root, config } = repo(writeSummary(`'{"files": 1, "tests"'`))
  const { result, lines } = await run(root, config)
  assert.equal(result.red, true)
  assert.match(result.verdict, /^GATE RED: small \(.*run summary.*not valid JSON/)
  assert.equal(lines.at(-1), result.verdict)
})

test('a summary that is JSON but not a run summary is red the same way', async () => {
  const { root, config } = repo(writeSummary(`'{"files": 1}'`))
  const { result } = await run(root, config)
  assert.match(result.verdict, /^GATE RED: small \(.*has no tier counts/)
})

test('control: a good run summary is green through the same path', async () => {
  const summary = {
    files: 1, tests: 2, skipped: 0, quarantined: 0, failed: 0, flaky: [], retriedBeyondRules: [],
    tiers: { small: { files: 1, tests: 2, protected: 0 }, medium: { files: 0, tests: 0, protected: 0 }, large: { files: 0, tests: 0, protected: 0 } },
  }
  const { root, config } = repo(writeSummary(`JSON.stringify(${JSON.stringify(summary)})`))
  const { result } = await run(root, config)
  assert.equal(result.red, false)
  assert.match(result.verdict, /^GATE GREEN/)
})

const withSkips = (skips: { label: string; reason: string }[], quarantined = 0) => ({
  files: 1, tests: 2, skipped: skips.length, quarantined, filtered: 0, skips, failed: 0, flaky: [], retriedBeyondRules: [],
  tiers: { small: { files: 1, tests: 2, protected: 0 }, medium: { files: 0, tests: 0, protected: 0 }, large: { files: 0, tests: 0, protected: 0 } },
})

test('the GATE line shows how many tests were skipped, and the gate output names each with its reason', async () => {
  const summary = withSkips([
    { label: 'a.test.ts > needs a db', reason: 'no database in this sandbox' },
    { label: 'b.test.ts > old', reason: 'no reason given (it.skip)' },
  ])
  const { root, config } = repo(writeSummary(`JSON.stringify(${JSON.stringify(summary)})`))
  const { result, lines } = await run(root, config)
  assert.equal(result.verdict, 'GATE GREEN (quarantined: 0, flaky: 0, skipped: 2)')
  assert.ok(lines.includes('  SKIPPED: a.test.ts > needs a db (no database in this sandbox)'), lines.join('\n'))
  assert.ok(lines.includes('  SKIPPED: b.test.ts > old (no reason given (it.skip))'))
})

test('quarantined tests are counted in "quarantined", not twice in "skipped"', async () => {
  const summary = withSkips([{ label: 'q.test.ts > flaky one', reason: 'quarantined (quarantine tag)' }], 1)
  const { root, config } = repo(writeSummary(`JSON.stringify(${JSON.stringify(summary)})`))
  const { result } = await run(root, config)
  assert.equal(result.verdict, 'GATE GREEN (quarantined: 1, flaky: 0, skipped: 0)')
})

test('a summary from a preset older than 0.6.0 (no skip list) still gives a GATE line', async () => {
  const summary = { ...withSkips([]), skipped: 3 } as Record<string, unknown>
  delete summary.skips
  delete summary.filtered
  const { root, config } = repo(writeSummary(`JSON.stringify(${JSON.stringify(summary)})`))
  const { result, lines } = await run(root, config)
  assert.equal(result.verdict, 'GATE GREEN (quarantined: 0, flaky: 0, skipped: 3)')
  assert.ok(lines.some((l) => l.includes('3 skipped') && l.includes('no reasons')), lines.join('\n'))
})

test('small and medium share one process, and the large tier still runs its own command (not the shared one again)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gates-run-'))
  mkdirSync(join(root, '.tmp'), { recursive: true })
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const summary = {
    files: 2, tests: 4, skipped: 0, quarantined: 0, failed: 0, flaky: [], retriedBeyondRules: [],
    tiers: { small: { files: 1, tests: 2, protected: 0, failed: 0 }, medium: { files: 1, tests: 2, protected: 0, failed: 0 }, large: { files: 0, tests: 0, protected: 0, failed: 0 } },
  }
  // a stand-in for `pnpm exec vitest run ...`: the shared run
  writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\necho "$@" >> "${join(root, 'invocations.txt')}"\ncat > "$TEST_PRESET_SUMMARY" <<'JSON'\n${JSON.stringify(summary)}\nJSON\n`, { mode: 0o755 })
  writeFileSync(join(root, 'large.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(join(root, 'invocations.txt'))}, 'LARGE\\n')\nwriteFileSync(process.env.TEST_PRESET_SUMMARY, JSON.stringify({ ...${JSON.stringify(summary)}, tests: 1, tiers: { ...${JSON.stringify(summary.tiers)}, large: { files: 1, tests: 1, protected: 0, failed: 0 } } }))\n`)
  const config = { stack: 'vitest', tiers: ['small', 'medium', 'large'], commands: { large: ['node', 'large.mjs'] } } as GatesConfig
  const path = process.env.PATH
  process.env.PATH = `${bin}:${path}`
  const log = console.log
  console.log = () => {}
  try {
    await runGates(root, config, { only: ['small', 'medium', 'large'] })
  } finally {
    console.log = log
    process.env.PATH = path
  }
  const invocations = readFileSync(join(root, 'invocations.txt'), 'utf8').trim().split('\n')
  assert.equal(invocations.length, 2, invocations.join('\n'))
  assert.match(invocations[0], /^exec vitest run --project unit --project nuxt/)
  assert.equal(invocations[1], 'LARGE')
})
