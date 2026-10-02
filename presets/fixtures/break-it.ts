// Break-it for the presets: plants each violation in the matching fixture, runs the fixture's tests
// through the preset, and checks the run is red for the stated reason (exit code and message). A planted
// file is always removed again. Usage: node break-it.ts <vitest|pytest|gates> [case-name-filter]
//
// Needs TEST_DATABASE_URL (a Postgres the environment provides) so the DB guard is proven against a
// database that would otherwise answer.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stack = process.argv[2]
const only = process.argv[3]

interface Case {
  name: string
  /** planted files: source under violations/<stack>, destination inside the fixture */
  plant: { from: string; to: string }[]
  command: string[]
  /** `red`: non-zero exit and the message; `green`: exit 0 and the message */
  expect: 'red' | 'green'
  message: RegExp
  /** sets the fixture up for the case; returns the function that puts it back */
  prepare?: (fixture: string) => () => void
  /** extra check after the run, returns an error text or undefined */
  after?: (fixture: string) => string | undefined
}

const vitestFixture = join(here, 'nuxt-app')
const run = ['pnpm', 'exec', 'vitest', 'run']

const vitestCases: Case[] = [
  {
    name: 'small test opens a socket',
    plant: [{ from: 'small-network.test.ts', to: 'test/unit/small-network.test.ts' }],
    command: [...run, 'test/unit/small-network.test.ts'],
    expect: 'red',
    message: /tests of the small tier never touch the network \(fetch http:\/\/203\.0\.113\.1\/\)[\s\S]*tests of the small tier never touch the network \(connect 203\.0\.113\.1:80\)/,
  },
  {
    name: 'small test writes outside its temp dir',
    plant: [{ from: 'small-write.test.ts', to: 'test/unit/small-write.test.ts' }],
    command: [...run, 'test/unit/small-write.test.ts'],
    expect: 'red',
    message: /tests of the small tier write only inside the temp dir \(writeFileSync [^)]*planted-write\.txt\)[\s\S]*\(writeFile [^)]*planted-write\.txt\)/,
    after: (f) => (existsSync(join(f, 'planted-write.txt')) ? 'the file was written anyway' : undefined),
  },
  {
    name: 'small test asks for the database',
    plant: [{ from: 'small-db.test.ts', to: 'test/unit/small-db.test.ts' }],
    command: [...run, 'test/unit/small-db.test.ts'],
    expect: 'red',
    message: /TEST_DATABASE_URL is empty: only a test tagged "medium"/,
  },
  {
    name: 'unknown tag is an error',
    plant: [{ from: 'unknown-tag.test.ts', to: 'test/unit/unknown-tag.test.ts' }],
    command: [...run, 'test/unit/unknown-tag.test.ts'],
    expect: 'red',
    message: /mediun/,
  },
  {
    name: 'retry in unit cannot happen',
    plant: [{ from: 'retry-small.test.ts', to: 'test/unit/retry-small.test.ts' }],
    command: [...run, 'test/unit/retry-small.test.ts'],
    expect: 'red',
    message: /\[test-preset\] FAIL: retry beyond the baseline's rules: .*retries itself in a small tier \(small tier, retried 1x\)/,
  },
  {
    name: 'e2e retry beyond one is red',
    plant: [{ from: 'retry-large-twice.e2e.test.ts', to: 'test/e2e/retry-large-twice.e2e.test.ts' }],
    command: [...run, 'test/e2e/retry-large-twice.e2e.test.ts'],
    expect: 'red',
    message: /\[test-preset\] FAIL: retry beyond the baseline's rules: .*retries more than once \(large tier, retried [23]x\)/,
  },
  {
    name: 'e2e pass on retry is reported as flaky',
    plant: [{ from: 'flaky-large.e2e.test.ts', to: 'test/e2e/flaky-large.e2e.test.ts' }],
    command: [...run, 'test/e2e/flaky-large.e2e.test.ts'],
    expect: 'green',
    message: /flaky 1[\s\S]*\[test-preset\] FLAKY \(passed on retry, not a clean pass\): .*fails once, passes on the retry/,
  },
  {
    name: 'small test over 5 s fails',
    plant: [{ from: 'limit-small.test.ts', to: 'test/unit/limit-small.test.ts' }],
    command: [...run, 'test/unit/limit-small.test.ts'],
    expect: 'red',
    message: /Test timed out in 5000ms/,
  },
  {
    name: 'medium test over 15 s fails, one over 5 s passes',
    plant: [{ from: 'limit-medium.test.ts', to: 'test/unit/limit-medium.test.ts' }],
    command: [...run, 'test/unit/limit-medium.test.ts'],
    expect: 'red',
    message: /^(?=[\s\S]*Test timed out in 15000ms)(?=[\s\S]*Tests\s+1 failed \| 1 passed)/,
  },
  {
    name: 'large test over 30 s fails',
    plant: [{ from: 'limit-large.e2e.test.ts', to: 'test/e2e/limit-large.e2e.test.ts' }],
    command: [...run, 'test/e2e/limit-large.e2e.test.ts'],
    expect: 'red',
    message: /Test timed out in 30000ms/,
  },
  {
    name: 'a run that selects no e2e file does not build',
    plant: [],
    command: [...run, 'test/unit/add.test.ts'],
    expect: 'green',
    message: /ran 1 files, 2 tests/,
    after: (f) => (existsSync(join(f, '.tmp/e2e-build-ran')) ? 'the e2e build ran' : undefined),
  },
]

// The break-it of the fixture's own control: the same selection that selects an e2e file does build.
const vitestControl: Case = {
  name: 'control: a run that selects an e2e file does build',
  plant: [],
  command: [...run, 'test/e2e/app.e2e.test.ts'],
  expect: 'green',
  message: /large 2/,
  after: (f) => (existsSync(join(f, '.tmp/e2e-build-ran')) ? undefined : 'the e2e build did not run'),
}


const gatesRun = ['pnpm', 'exec', 'test-gates']
const withFile = (path: string, content: string) => (f: string) => {
  const file = join(f, path)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined
  writeFileSync(file, content)
  return () => (before === undefined ? rmSync(file, { force: true }) : writeFileSync(file, before))
}

const gatesCases: Case[] = [
  {
    name: 'control: all three tiers green against the committed floors',
    plant: [],
    command: [...gatesRun],
    expect: 'green',
    message: /GATE GREEN \(quarantined: 0, flaky: 0\)/,
  },
  {
    name: 'a tier below its floor fails the gate',
    plant: [],
    command: [...gatesRun, '--only=small'],
    expect: 'red',
    message: /GATE RED: small \(4 small tests is below the floor of 99\)/,
    prepare: withFile('test-floors.json', '{"small": 99, "medium": 2, "large": 2}'),
  },
  {
    name: 'a tier that ran zero tests fails the gate',
    plant: [],
    command: [...gatesRun, '--only=medium'],
    expect: 'red',
    message: /GATE RED: medium \(/,
    prepare: (f) => {
      renameSync(join(f, 'test/unit/db.test.ts'), join(f, 'test/unit/db.test.ts.off'))
      return () => renameSync(join(f, 'test/unit/db.test.ts.off'), join(f, 'test/unit/db.test.ts'))
    },
  },
  {
    name: 'a failing test makes the gate script exit non-zero and names the gate',
    plant: [{ from: 'failing-small.test.ts', to: 'test/unit/failing-small.test.ts' }],
    command: [...gatesRun, '--only=small'],
    expect: 'red',
    message: /GATE RED: small \(exit 1\)/,
  },
  {
    name: 'a tier whose run writes no summary is NOT MEASURED, not green',
    plant: [],
    command: [...gatesRun, '--only=small', '--config=.tmp/no-preset.config.json'],
    expect: 'red',
    message: /GATE RED: small \(no run summary written: the preset did not run, so the count guard is NOT MEASURED\)/,
    prepare: (f) => {
      mkdirSync(join(f, '.tmp'), { recursive: true })
      return withFile('.tmp/no-preset.config.json', '{"stack":"vitest","commands":{"small":["node","-e","process.exit(0)"]}}')(f)
    },
  },
  {
    name: 'an unknown gate name is a usage error (exit 2)',
    plant: [],
    command: [...gatesRun, '--only=smol'],
    expect: 'red',
    message: /unknown gate "smol"/,
  },
]

const cases: Record<string, { fixture: string; cases: Case[]; before?: (f: string) => void }> = {
  vitest: {
    fixture: vitestFixture,
    cases: [vitestControl, ...vitestCases],
    before: (f) => {
      rmSync(join(f, '.tmp/e2e-build-ran'), { force: true })
    },
  },
}

cases.gates = {
  fixture: vitestFixture,
  cases: gatesCases,
  before: () => {},
}

const plan = cases[stack]
if (!plan) {
  console.error(`usage: node break-it.ts <${Object.keys(cases).join('|')}> [filter]`)
  process.exit(2)
}

let bad = 0
for (const c of plan.cases) {
  if (only && !c.name.includes(only)) continue
  plan.before?.(plan.fixture)
  const planted: string[] = []
  let undo: (() => void) | undefined
  try {
    for (const p of c.plant) {
      const to = join(plan.fixture, p.to)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(join(here, 'violations', stack === 'gates' ? 'vitest' : stack, p.from), to)
      planted.push(to)
    }
    undo = c.prepare?.(plan.fixture)
    const [cmd, ...args] = c.command
    const r = spawnSync(cmd, args, { cwd: plan.fixture, encoding: 'utf8', env: process.env })
    const out = `${r.stdout}\n${r.stderr}`.replace(/\u001b\[[0-9;]*m/g, '')
    const statusOk = c.expect === 'red' ? r.status !== 0 : r.status === 0
    const matched = c.message.test(out)
    const extra = c.after?.(plan.fixture)
    const ok = statusOk && matched && !extra
    if (!ok) bad++
    const first = out.split('\n').find((l) => /GATE (RED|GREEN)|Error:|\[test-preset\] (FAIL|FLAKY)|exited|test-gates:/.test(l))
    console.log(
      `${ok ? 'OK ' : 'BAD'} ${c.expect.toUpperCase().padEnd(5)} ${c.name} (exit ${r.status})` +
        (first ? `\n      ${first.trim().slice(0, 220)}` : '') +
        (!ok ? `\n      status ok: ${statusOk}, message matched: ${matched}${extra ? `, ${extra}` : ''}` : ''),
    )
    if (!ok && process.env.BREAK_IT_VERBOSE) console.log(out)
  } finally {
    undo?.()
    for (const f of planted) rmSync(f, { force: true })
    rmSync(join(plan.fixture, 'planted-write.txt'), { force: true })
  }
}
console.log(bad === 0 ? 'BREAK-IT GREEN' : `BREAK-IT RED: ${bad} case(s) did not behave as planned`)
process.exit(bad === 0 ? 0 : 1)
