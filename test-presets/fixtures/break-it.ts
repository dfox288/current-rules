// Break-it for the test-presets: plants each violation in the matching fixture, runs the fixture's tests
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
  /** the exact exit status, when it matters (66: a narrowed run in which no tier ran a test) */
  exit?: number
  /** sets the fixture up for the case; returns the function that puts it back */
  prepare?: (fixture: string) => () => void
  /** extra check after the run, returns an error text or undefined */
  after?: (fixture: string) => string | undefined
}

const vitestFixture = join(here, 'nuxt-app')
const run = ['pnpm', 'exec', 'vitest', 'run']

const workersConfig = `import { defineTestConfig } from '@dfox288/test-preset-vitest'

export default defineTestConfig({
  unit: { include: ['test/unit/**/*.test.ts'], justification: 'break-it: workers', test: { maxWorkers: 3 } },
  e2e: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    hookTimeout: 120_000,
    justification: 'break-it: workers',
    test: { maxWorkers: 2 },
  },
})
`

const withFile = (path: string, content: string) => (f: string) => {
  const file = join(f, path)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined
  writeFileSync(file, content)
  return () => (before === undefined ? rmSync(file, { force: true }) : writeFileSync(file, before))
}

const vitestCases: Case[] = [
  {
    name: 'small test opens a socket',
    plant: [{ from: 'small-network.test.ts', to: 'test/unit/small-network.test.ts' }],
    command: [...run, 'test/unit/small-network.test.ts'],
    expect: 'red',
    message: /tests of the small tier never touch the network \(fetch http:\/\/203\.0\.113\.1\/\)[\s\S]*tests of the small tier never touch the network \(connect 203\.0\.113\.1:80\)/,
  },
  {
    name: 'small test opens a socket in the nuxt project',
    plant: [{ from: 'small-network.test.ts', to: 'test/nuxt/small-network.test.ts' }],
    command: [...run, 'test/nuxt/small-network.test.ts'],
    expect: 'red',
    message: /(\|nuxt\||\[nuxt\])[\s\S]*tests of the small tier never touch the network \(fetch http:\/\/203\.0\.113\.1\/\)/,
  },
  {
    name: 'a test cannot raise its tier limit (small and medium)',
    plant: [{ from: 'timeout-override.test.ts', to: 'test/unit/timeout-override.test.ts' }],
    command: [...run, 'test/unit/timeout-override.test.ts'],
    expect: 'red',
    message: /^(?=[\s\S]*FAIL: sets its own timeout above the tier's limit: .*raises its own limit above small \(small tier, 60000 ms > 5000 ms\))(?=[\s\S]*raises its own limit above medium \(medium tier, 60000 ms > 15000 ms\))(?![\s\S]*lowers its own limit \(allowed\) \()/,
  },
  {
    name: 'small test sends a UDP datagram',
    plant: [{ from: 'small-udp.test.ts', to: 'test/unit/small-udp.test.ts' }],
    command: [...run, 'test/unit/small-udp.test.ts'],
    expect: 'red',
    message: /tests of the small tier never touch the network \(udp send 203\.0\.113\.1:53\)/,
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
    name: 'a relative fetch URL is judged against location; absolute non-loopback and small stay refused',
    plant: [{ from: 'relative-fetch.test.ts', to: 'test/unit/relative-fetch.test.ts' }],
    command: [...run, 'test/unit/relative-fetch.test.ts'],
    expect: 'green',
    message: /Tests\s+5 passed \(5\)/,
  },
  {
    name: 'small: a relative fetch that registerEndpoint answers in-process is allowed (fetch and $fetch), and only while registered',
    plant: [{ from: 'register-endpoint.test.ts', to: 'test/nuxt/register-endpoint.test.ts' }],
    command: [...run, 'test/nuxt/register-endpoint.test.ts'],
    expect: 'green',
    message: /Tests\s+3 passed \(3\)/,
  },
  {
    name: 'small: next to registerEndpoint an unregistered relative URL, an absolute URL, a localhost port and a protocol-relative URL stay refused',
    plant: [{ from: 'register-endpoint-refused.test.ts', to: 'test/nuxt/register-endpoint-refused.test.ts' }],
    command: [...run, 'test/nuxt/register-endpoint-refused.test.ts'],
    expect: 'red',
    message: /^(?=[\s\S]*never touch the network \(fetch \/api\/unregistered\))(?=[\s\S]*never touch the network \(fetch http:\/\/localhost:\d+\/api\/hello\))(?=[\s\S]*never touch the network \(fetch http:\/\/127\.0\.0\.1:9\/api\/hello\))(?=[\s\S]*never touch the network \(fetch \/\/203\.0\.113\.1\/api\/hello\))(?=[\s\S]*Tests\s+4 failed)/,
  },
  {
    name: 'medium: a hostname that only looks like loopback or the database host is refused (exact-hostname rule)',
    plant: [{ from: 'medium-lookalike.test.ts', to: 'test/unit/medium-lookalike.test.ts' }],
    command: [...run, 'test/unit/medium-lookalike.test.ts'],
    expect: 'green',
    message: /Tests\s+10 passed \(10\)/,
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
    name: 'every skipped test is named with a reason, whatever way it was skipped',
    plant: [{ from: 'skips.test.ts', to: 'test/unit/skips.test.ts' }],
    command: [...run, 'test/unit/skips.test.ts'],
    expect: 'green',
    message: /^(?=[\s\S]*SKIPPED: test\/unit\/skips\.test\.ts > ctx skip \(no database in this sandbox\))(?=[\s\S]*SKIPPED: test\/unit\/skips\.test\.ts > plain skip \(no reason given)(?=[\s\S]*SKIPPED: test\/unit\/skips\.test\.ts > skipIf \(no reason given)(?=[\s\S]*SKIPPED: test\/unit\/skips\.test\.ts > skipped suite > inner \(no reason given)(?=[\s\S]*SKIPPED: test\/unit\/skips\.test\.ts > a todo \(todo)(?=[\s\S]*SKIPPED: test\/unit\/skips\.test\.ts > quarantined \(quarantined)(?=[\s\S]*skipped 6, quarantined 1)/,
  },
  {
    name: 'retry in unit cannot happen',
    plant: [{ from: 'retry-small.test.ts', to: 'test/unit/retry-small.test.ts' }],
    command: [...run, 'test/unit/retry-small.test.ts'],
    expect: 'red',
    message: /^(?=[\s\S]*retries itself in a small tier[\s\S]*small and medium tests never retry \(this one asks for 2\))(?![\s\S]*BODY RAN)(?![\s\S]*retried 1x)/,
  },
  {
    name: 'retry in nuxt cannot happen either',
    plant: [{ from: 'retry-small.test.ts', to: 'test/nuxt/retry-small.test.ts' }],
    command: [...run, 'test/nuxt/retry-small.test.ts'],
    expect: 'red',
    message: /^(?=[\s\S]*small and medium tests never retry \(this one asks for 2\))(?![\s\S]*BODY RAN)/,
  },
  {
    // `--retry` on the command line is the config-level form of the same thing
    name: 'retry from the command line is refused in unit',
    plant: [{ from: 'add-twice.test.ts', to: 'test/unit/add-twice.test.ts' }],
    command: [...run, '--retry=1', 'test/unit/add-twice.test.ts'],
    expect: 'red',
    message: /^(?=[\s\S]*small and medium tests never retry \(this one asks for 1\))(?![\s\S]*BODY RAN)/,
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
    // Vitest throws "different 'maxWorkers' but same 'sequence.groupOrder'" for projects of one order (beacon, 2026-10-03):
    // the preset gives unit and nuxt order 0 and e2e order 1.
    name: 'projects with different maxWorkers run: the preset orders unit before e2e',
    plant: [],
    command: [...run, 'test/unit/add.test.ts', 'test/e2e/app.e2e.test.ts'],
    expect: 'green',
    message: /ran 2 files, 4 tests \(small 2, medium 0, large 2\)/,
    prepare: withFile('vitest.config.ts', workersConfig),
    after: (f) => (existsSync(join(f, '.tmp/e2e-build-ran')) ? undefined : 'the e2e build did not run'),
  },
  {
    name: 'a run that executed 0 files and hit an unhandled error is red',
    plant: [{ from: 'unhandled-no-files.test.ts', to: 'test/unit/unhandled-no-files.test.ts' }],
    command: [...run, 'test/unit/unhandled-no-files.test.ts'],
    expect: 'red',
    message: /\[test-preset\] FAIL: the run executed 0 files and hit 1 unhandled error; the first: planted unhandled rejection/,
  },
  {
    // `--dangerouslyIgnoreUnhandledErrors` makes Vitest itself exit 0 for the same run: the preset's reporter is red alone.
    name: 'a run that executed 0 files and hit an unhandled error is red even when Vitest ignores it',
    plant: [{ from: 'unhandled-no-files.test.ts', to: 'test/unit/unhandled-no-files.test.ts' }],
    command: [...run, '--dangerouslyIgnoreUnhandledErrors', 'test/unit/unhandled-no-files.test.ts'],
    expect: 'red',
    message: /\[test-preset\] FAIL: the run executed 0 files and hit 1 unhandled error/,
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


const pytestFixture = join(here, 'python-pkg')
const pyrun = ['uv', 'run', '--group', 'test', 'pytest', '-p', 'no:cacheprovider']
const pyPlant = (file: string) => [{ from: file, to: `tests/${file}` }]

const pytestCases: Case[] = [
  {
    name: 'control: the fixture suite is green in all three tiers',
    plant: [],
    command: [...pyrun],
    expect: 'green',
    message: /ran 5 files, 9 tests \(small 6, medium 2, large 1\)/,
  },
  {
    name: 'small test opens a socket',
    plant: pyPlant('test_small_network.py'),
    command: [...pyrun, 'tests/test_small_network.py'],
    expect: 'red',
    message: /SocketBlockedError[\s\S]*SocketBlockedError[\s\S]*2 failed/,
  },
  {
    name: 'small test writes outside its tmp_path',
    plant: pyPlant('test_small_write.py'),
    command: [...pyrun, 'tests/test_small_write.py'],
    expect: 'red',
    message: /^(?=[\s\S]*\(open [^)]*planted-write\.txt\))(?=[\s\S]*\(os\.mkdir [^)]*planted-dir\))(?=[\s\S]*\(shutil\.copyfile [^)]*planted-copy\.txt\))(?=[\s\S]*\(sqlite3\.connect [^)]*planted\.db\))(?=[\s\S]*6 failed)/,
    after: (f) => {
      const left = ['planted-write.txt', 'planted-dir', 'planted-copy.txt', 'planted.db'].filter((n) => existsSync(join(f, n)))
      left.forEach((n) => rmSync(join(f, n), { recursive: true, force: true }))
      return left.length ? `written anyway: ${left.join(', ')}` : undefined
    },
  },
  {
    name: 'importlib\'s bytecode write into __pycache__ is allowed, a plain write beside it is not',
    plant: [
      { from: 'test_small_bytecode.py', to: 'tests/test_small_bytecode.py' },
      { from: '_bytecode_probe.py', to: 'tests/_bytecode_probe.py' },
    ],
    command: [...pyrun, 'tests/test_small_bytecode.py'],
    expect: 'red',
    message: /^(?=[\s\S]*\(open [^)]*planted-plain\.txt\))(?=[\s\S]*\(open [^)]*planted-lookalike\.pyc\.123\))(?![\s\S]*__pycache__)(?=[\s\S]*2 failed, 1 passed)/,
    after: (f) => {
      const left = ['planted-plain.txt', 'planted-lookalike.pyc.123'].filter((n) => existsSync(join(f, n)))
      left.forEach((n) => rmSync(join(f, n), { recursive: true, force: true }))
      rmSync(join(f, 'tests/__pycache__/_bytecode_probe.cpython-314.pyc'), { force: true })
      return left.length ? `written anyway: ${left.join(', ')}` : undefined
    },
  },
  {
    name: 'removing a link inside tmp_path is allowed, a plain file or a write through a link outside is not',
    plant: pyPlant('test_small_symlink.py'),
    command: [...pyrun, 'tests/test_small_symlink.py'],
    expect: 'red',
    message: /^(?=[\s\S]*\(os\.remove [^)]*planted-victim\.txt\))(?=[\s\S]*\(open [^)]*planted-outside\.txt\))(?=[\s\S]*2 failed, 1 passed)/,
    prepare: withFile('planted-victim.txt', 'x'),
    after: (f) => {
      const left = ['planted-victim.txt', 'planted-outside.txt'].filter((n) => existsSync(join(f, n)))
      left.forEach((n) => rmSync(join(f, n), { force: true }))
      return left.includes('planted-outside.txt') ? 'written anyway: planted-outside.txt' : undefined
    },
  },
  {
    name: 'tempfile idioms are a small test\'s own temp files',
    plant: pyPlant('test_tempfile_idioms.py'),
    command: [...pyrun, 'tests/test_tempfile_idioms.py'],
    expect: 'green',
    message: /4 passed/,
  },
  {
    name: 'the tier is the marker, not a directory name',
    plant: [{ from: 'test_dirname.py', to: 'tests/large/test_dirname.py' }],
    command: [...pyrun, 'tests/large/test_dirname.py'],
    expect: 'green',
    message: /ran 1 files, 1 tests \(small 1, medium 0, large 0\)/,
    after: (f) => (rmSync(join(f, 'tests/large'), { recursive: true, force: true }), undefined),
  },
  {
    name: 'threads and executors are under small\'s guards',
    plant: pyPlant('test_small_threads.py'),
    command: [...pyrun, 'tests/test_small_threads.py'],
    expect: 'red',
    message: /^(?=[\s\S]*write only inside their tmp_path[\s\S]*write only inside their tmp_path)(?=[\s\S]*SocketBlockedError)(?=[\s\S]*3 failed)/,
    after: (f) => (existsSync(join(f, 'planted-write.txt')) ? (rmSync(join(f, 'planted-write.txt')), 'written anyway') : undefined),
  },
  {
    name: 'small test asks for the database',
    plant: pyPlant('test_small_db.py'),
    command: [...pyrun, 'tests/test_small_db.py'],
    expect: 'red',
    message: /TEST_DATABASE_URL is empty: only a test marked medium/,
  },
  {
    name: 'unknown marker is an error',
    plant: pyPlant('test_unknown_marker.py'),
    command: [...pyrun, 'tests/test_unknown_marker.py'],
    expect: 'red',
    message: /'mediun' not found in `markers` configuration option/,
  },
  {
    name: 'a test cannot set its own timeout',
    plant: pyPlant('test_own_timeout.py'),
    command: [...pyrun, 'tests/test_own_timeout.py'],
    expect: 'red',
    message: /sets its own timeout; the limit is fixed by the tier/,
  },
  {
    name: 'small test over 5 s fails',
    plant: pyPlant('test_limit_small.py'),
    command: [...pyrun, 'tests/test_limit_small.py'],
    expect: 'red',
    message: /Timeout \(>5\.0s\)/,
  },
  {
    name: 'medium test over 15 s fails, one over 5 s passes',
    plant: pyPlant('test_limit_medium.py'),
    command: [...pyrun, 'tests/test_limit_medium.py'],
    expect: 'red',
    message: /^(?=[\s\S]*Timeout \(>15\.0s\))(?=[\s\S]*1 failed, 1 passed)/,
  },
  {
    name: 'large test over 30 s fails',
    plant: pyPlant('test_limit_large.py'),
    command: [...pyrun, 'tests/test_limit_large.py'],
    expect: 'red',
    message: /Timeout \(>30\.0s\)/,
  },
  {
    name: 'a hang in teardown after a failed test is stopped by the limit',
    plant: pyPlant('test_teardown_hang.py'),
    command: [...pyrun, 'tests/test_teardown_hang.py'],
    expect: 'red',
    message: /^(?=[\s\S]*Failed: Timeout \(>15\.0s\))(?=[\s\S]*1 failed, 1 error)/,
  },
  {
    name: 'a quarantined test is skipped and counted, not run',
    plant: pyPlant('test_quarantined.py'),
    command: [...pyrun, 'tests/test_quarantined.py', '-rs'],
    expect: 'green',
    message: /skipped 1, quarantined 1/,
  },
]

const gatesRun = ['pnpm', 'exec', 'test-gates']
// a source file and the one test that imports it: what a `related` run is told apart on
const relatedPair = [
  { from: 'related-only.ts', to: 'app/utils/related-only.ts' },
  { from: 'related-only.test.ts', to: 'test/unit/related-only.test.ts' },
]
const gatesCases: Case[] = [
  {
    name: 'control: all three tiers green against the committed floors',
    plant: [],
    // --base=HEAD: the docs gate is NOT MEASURED without a base ref, and a CI checkout has no origin/main
    command: [...gatesRun, '--base=HEAD'],
    expect: 'green',
    message: /GATE GREEN \(quarantined: 0, flaky: 0, skipped: 0\)/,
  },
  {
    name: 'skips show on the GATE line and are named in the gate output (the quarantined one is counted apart)',
    plant: [{ from: 'skips.test.ts', to: 'test/unit/skips.test.ts' }],
    command: [...gatesRun, '--base=HEAD'],
    expect: 'green',
    message: /^(?=[\s\S]*SKIPPED: test\/unit\/skips\.test\.ts > ctx skip \(no database in this sandbox\))(?=[\s\S]*SKIPPED: test\/unit\/skips\.test\.ts > quarantined \(quarantined)(?=[\s\S]*GATE GREEN \(quarantined: 1, flaky: 0, skipped: 5\))/,
  },
  {
    name: 'a tier below its floor fails the gate',
    plant: [],
    command: [...gatesRun, '--only=small'],
    expect: 'red',
    message: /GATE RED: small \(3 small tests is below the floor of 99\)/,
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
    name: 'control: the medium tier alone counts the unit medium tests and the nuxt tests',
    plant: [],
    command: [...gatesRun, '--only=medium'],
    expect: 'green',
    message: /medium +OK +\d+s +3 tests, 2 files \(floor 3\)/,
  },
  {
    name: 'a medium test in a new file is counted by the medium tier, with no file list to keep',
    plant: [{ from: 'medium-extra.test.ts', to: 'test/unit/medium-extra.test.ts' }],
    command: [...gatesRun, '--only=medium'],
    expect: 'green',
    message: /medium +OK +\d+s +4 tests, 3 files \(floor 3\)/,
  },
  {
    name: 'control: small and medium together are one Vitest process, each tier counted from it',
    plant: [],
    command: [...gatesRun, '--only=small,medium'],
    expect: 'green',
    message: /^(?=[\s\S]*=== small, medium \(one Vitest process\) ===)(?=[\s\S]*small +OK +\d+s +3 tests, 2 files \(floor 3\))(?=[\s\S]*medium +OK +\d+s +3 tests, 2 files \(floor 3\))(?=[\s\S]*GATE GREEN)(?![\s\S]*=== small ===)/,
    after: (f) => (existsSync(join(f, '.tmp/gates/small-medium.summary.json')) ? undefined : 'no shared summary was written'),
  },
  {
    // The unit files are collected once: the shared run's log holds one "Test Files" line, the separate runs two.
    name: 'small and medium together collect the unit files once',
    plant: [],
    command: [...gatesRun, '--only=small,medium'],
    expect: 'green',
    message: /^(?=[\s\S]*Test Files {2}\d+ passed \(\d+\))(?![\s\S]*Test Files [\s\S]*Test Files )/,
  },
  {
    name: 'together, a tier below its floor is red alone: the other tier of the run stays OK',
    plant: [],
    command: [...gatesRun, '--only=small,medium'],
    expect: 'red',
    message: /^(?=[\s\S]*small +FAILED +\d+s +3 small tests is below the floor of 99)(?=[\s\S]*medium +OK +\d+s +3 tests, 2 files)(?=[\s\S]*GATE RED: small \(3 small tests is below the floor of 99\))/,
    prepare: withFile('test-floors.json', '{"small": 99, "medium": 3, "large": 2}'),
  },
  {
    name: 'together, a medium tier with its tests gone is red at the floor, small stays OK',
    plant: [],
    command: [...gatesRun, '--only=small,medium'],
    expect: 'red',
    message: /^(?=[\s\S]*small +OK)(?=[\s\S]*GATE RED: medium \(1 medium tests is below the floor of 3\))/,
    prepare: (f) => {
      renameSync(join(f, 'test/unit/db.test.ts'), join(f, 'test/unit/db.test.ts.off'))
      return () => renameSync(join(f, 'test/unit/db.test.ts.off'), join(f, 'test/unit/db.test.ts'))
    },
  },
  {
    name: 'together, a failing medium test is the medium tier\'s red; small stays OK',
    plant: [{ from: 'failing-medium.test.ts', to: 'test/unit/failing-medium.test.ts' }],
    command: [...gatesRun, '--only=small,medium'],
    expect: 'red',
    message: /^(?=[\s\S]*small +OK)(?=[\s\S]*medium +FAILED +\d+s +exit 1)(?=[\s\S]*GATE RED: medium \(exit 1\))/,
  },
  {
    name: 'together, a failing small test is the small tier\'s red; medium stays OK',
    plant: [{ from: 'failing-small.test.ts', to: 'test/unit/failing-small.test.ts' }],
    command: [...gatesRun, '--only=small,medium'],
    expect: 'red',
    message: /^(?=[\s\S]*small +FAILED +\d+s +exit 1)(?=[\s\S]*medium +OK)(?=[\s\S]*GATE RED: small \(exit 1\))/,
  },
  {
    name: 'together, a medium test whose tag is set by a variable runs (no scan to miss it)',
    plant: [{ from: 'medium-tags-by-variable.test.ts', to: 'test/unit/medium-tags-by-variable.test.ts' }],
    command: [...gatesRun, '--only=small,medium'],
    expect: 'green',
    message: /medium +OK +\d+s +4 tests, 3 files \(floor 3\)/,
  },
  {
    name: 'medium alone: a medium test whose tag is set by a variable still runs',
    plant: [{ from: 'medium-tags-by-variable.test.ts', to: 'test/unit/medium-tags-by-variable.test.ts' }],
    command: [...gatesRun, '--only=medium'],
    expect: 'green',
    message: /medium +OK +\d+s +4 tests, 3 files/,
  },
  {
    name: 'a commands.small override: the small tier runs its own command, medium runs on its own and finds the variable-tagged test',
    plant: [{ from: 'medium-tags-by-variable.test.ts', to: 'test/unit/medium-tags-by-variable.test.ts' }],
    command: [...gatesRun, '--only=small,medium', '--config=.tmp/small-override.config.json'],
    expect: 'green',
    message: /^(?=[\s\S]*=== medium ===)(?=[\s\S]*medium +OK +\d+s +4 tests, 3 files)(?![\s\S]*one Vitest process)/,
    prepare: (f) => {
      mkdirSync(join(f, '.tmp'), { recursive: true })
      return withFile(
        '.tmp/small-override.config.json',
        '{"stack":"vitest","commands":{"small":["pnpm","exec","vitest","run","--project","unit","--tags-filter","!medium"]}}',
      )(f)
    },
  },
  {
    // Vitest's static scan reads a file's own source: a test file that is only the shape test's import has no test in it
    // ("No test suite found") unless the preset's plugin expands it. The planted file is exactly that one line.
    name: 'the shape test as a one-line import file does not stop the medium scan',
    plant: [{ from: 'checks-map-oneline.test.ts', to: 'test/unit/checks-map-oneline.test.ts' }],
    command: ['pnpm', 'exec', 'vitest', 'list', '--tags-filter', 'medium', '--project', 'unit'],
    expect: 'green',
    message: /^(?![\s\S]*No test suite found)(?=[\s\S]*db\.test\.ts > stores a row in a schema of its own)/,
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
    // Vitest exits 0 (`--dangerouslyIgnoreUnhandledErrors`) and the narrowed tier selected "no test": before 0.6.0 a skip, exit 66.
    // The preset's reporter now exits 1 itself; the gate script's own check (judgeTier) is covered by the unit tests.
    name: 'a narrowed tier whose run executed 0 files and hit an unhandled error is red, not a skip',
    plant: [{ from: 'unhandled-no-files.test.ts', to: 'test/unit/unhandled-no-files.test.ts' }],
    command: [...gatesRun, '--only=small', '--config=.tmp/ignore-unhandled.config.json', '--small-tests=test/unit/unhandled-no-files.test.ts'],
    expect: 'red',
    exit: 1,
    message: /GATE RED: small \(exit 1\)/,
    prepare: (f) => {
      mkdirSync(join(f, '.tmp'), { recursive: true })
      return withFile(
        '.tmp/ignore-unhandled.config.json',
        '{"stack":"vitest","commands":{"small":["pnpm","exec","vitest","run","--project","unit","--dangerouslyIgnoreUnhandledErrors"]}}',
      )(f)
    },
  },
  {
    name: 'a corrupt run summary is red with its reason and the GATE line is printed',
    plant: [],
    command: [...gatesRun, '--only=small', '--config=.tmp/corrupt-summary.config.json'],
    expect: 'red',
    exit: 1,
    message: /not valid JSON[\s\S]*GATE RED: small \(the run summary .* is not valid JSON/,
    prepare: (f) => {
      mkdirSync(join(f, '.tmp'), { recursive: true })
      return withFile(
        '.tmp/corrupt-summary.config.json',
        JSON.stringify({ stack: 'vitest', commands: { small: ['node', '-e', 'require("fs").writeFileSync(process.env.TEST_PRESET_SUMMARY, "{\\"files\\": 1, ")'] } }),
      )(f)
    },
  },
  {
    name: 'protected count: direct tag and a tagged group are counted, an untagged test is not',
    plant: [{ from: 'protected-kinds.test.ts', to: 'test/unit/protected-kinds.test.ts' }],
    command: [...gatesRun, '--only=small'],
    expect: 'green',
    message: /^(?=[\s\S]*^ {2}small: 7 tests, 4 protected$)/m,
  },
  {
    name: 'protected count: a tier with none says 0, the line is there',
    plant: [],
    command: [...gatesRun, '--only=large'],
    expect: 'green',
    message: /^ {2}large: 2 tests, 0 protected$/m,
  },
  {
    // The fixture's small tier is add.test.ts (2 tests), protected.test.ts (1) and the planted related-only.test.ts (1).
    name: 'control: the whole small tier with the planted pair has four tests in three files',
    plant: relatedPair,
    command: [...gatesRun, '--only=small'],
    expect: 'green',
    message: /small +OK +\d+s +4 tests, 3 files \(floor 3\)/,
  },
  {
    name: 'related: a changed file imported by one test runs that test, not the whole tier',
    plant: relatedPair,
    command: [...gatesRun, '--only=small', '--related=app/utils/related-only.ts'],
    expect: 'green',
    message: /small +OK +\d+s +1 tests, 1 files \(narrowed, floor not checked\)[\s\S]*GATE GREEN/,
  },
  {
    name: 'related: a file two tests import runs both and the floor is not applied',
    plant: relatedPair,
    command: [...gatesRun, '--only=small', '--related=app/utils/add.ts'],
    expect: 'green',
    message: /small +OK +\d+s +3 tests, 2 files \(narrowed, floor not checked\)/,
  },
  {
    name: 'related: a changed test file runs itself',
    plant: relatedPair,
    command: [...gatesRun, '--only=small', '--related=test/unit/related-only.test.ts'],
    expect: 'green',
    message: /small +OK +\d+s +1 tests, 1 files \(narrowed/,
  },
  {
    name: 'related: small and medium, the medium tier has nothing related and is skipped with its reason',
    plant: relatedPair,
    command: [...gatesRun, '--only=small,medium', '--related=app/utils/related-only.ts'],
    expect: 'green',
    message: /^(?=[\s\S]*small +OK +\d+s +1 tests)(?=[\s\S]*medium +skipped +\d+s +narrowed: no medium test is related to the selected files)(?=[\s\S]*GATE GREEN)/,
    exit: 0,
  },
  {
    name: 'related: a changed file no test imports skips the kind with the files named, and the run exits 66 (no tier ran a test)',
    plant: [],
    command: [...gatesRun, '--only=small,medium', '--related=server/api/ping.get.ts'],
    expect: 'green',
    exit: 66,
    message: /^(?=[\s\S]*gates: small: narrowed: no small test is related to the selected files \(changed files: server\/api\/ping\.get\.ts\))(?=[\s\S]*GATE SKIPPED: narrowed run, no tier selected a test)(?![\s\S]*GATE (GREEN|RED))/,
  },
  {
    name: 'related: the large tier is not narrowed by a changed file',
    plant: [],
    command: [...gatesRun, '--only=large', '--related=app/utils/add.ts'],
    expect: 'green',
    message: /large +OK +\d+s +2 tests, \d+ files \(floor 2\)/,
  },
  {
    name: 'test paths: a tier given one test file runs that file only',
    plant: relatedPair,
    command: [...gatesRun, '--only=small', '--small-tests=test/unit/add.test.ts'],
    expect: 'green',
    message: /small +OK +\d+s +2 tests, 1 files \(narrowed, floor not checked\)/,
  },
  {
    name: 'test paths: --tests reaches every tier of the run; the nuxt test runs in medium',
    plant: [],
    command: [...gatesRun, '--only=small,medium', '--tests=test/unit/add.test.ts', '--tests=test/nuxt/greeting.test.ts'],
    expect: 'green',
    message: /^(?=[\s\S]*small +OK +\d+s +2 tests, 1 files)(?=[\s\S]*medium +OK +\d+s +1 tests, 1 files)/,
  },
  {
    name: 'a narrowed run cannot raise floors',
    plant: [],
    command: [...gatesRun, '--only=small', '--related=app/utils/add.ts', '--raise-floors'],
    expect: 'red',
    message: /--raise-floors raises a floor from a whole tier/,
  },
  {
    name: 'a test path that does not exist is a usage error (exit 2)',
    plant: [],
    command: [...gatesRun, '--only=small', '--tests=test/unit/missing.test.ts'],
    expect: 'red',
    message: /test\/unit\/missing\.test\.ts does not exist/,
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

const gatesPyRun = ['node', '../../gates/dist/cli.js']
cases['gates-pytest'] = {
  fixture: pytestFixture,
  cases: [
    {
      name: 'control: all three pytest tiers green against the committed floors',
      plant: [],
      command: [...gatesPyRun, '--base=HEAD'], // as the Nuxt control: no origin/main in a CI checkout
      expect: 'green',
      message: /GATE GREEN \(quarantined: 0, flaky: 0, skipped: 0\)/,
    },
    {
      name: 'protected count: direct, class and module marks are counted, an unmarked test is not',
      plant: [
        { from: 'test_protected_kinds.py', to: 'tests/test_protected_kinds.py' },
        { from: 'test_protected_module.py', to: 'tests/test_protected_module.py' },
      ],
      command: [...gatesPyRun, '--only=small'],
      expect: 'green',
      message: /^ {2}small: 12 tests, 6 protected$/m,
    },
    {
      name: 'protected count: a tier with none says 0, the line is there',
      plant: [],
      command: [...gatesPyRun, '--only=large'],
      expect: 'green',
      message: /^ {2}large: 1 tests, 0 protected$/m,
    },
    {
      name: 'related: pytest has no narrowing step, a usage error (exit 2)',
      plant: [],
      command: [...gatesPyRun, '--only=small', '--related=src/fixture_pkg/__init__.py'],
      expect: 'red',
      message: /pytest has no narrowing step/,
    },
    {
      name: 'test paths: a pytest tier given one file runs that file only',
      plant: [],
      command: [...gatesPyRun, '--only=small', '--small-tests=tests/test_add.py'],
      expect: 'green',
      message: /small +OK +\d+s +2 tests, 1 files \(narrowed, floor not checked\)/,
    },
    {
      name: 'test paths: a file with no test of the tier is a skip with its reason, not a failure; the run exits 66',
      plant: [],
      command: [...gatesPyRun, '--only=small', '--small-tests=tests/test_medium.py'],
      expect: 'green',
      exit: 66,
      message: /^(?=[\s\S]*small +skipped +\d+s +narrowed: no small test is related to the selected files)(?=[\s\S]*GATE SKIPPED: narrowed run, no tier selected a test)/,
    },
    {
      name: 'a pytest tier below its floor fails the gate',
      plant: [],
      command: [...gatesPyRun, '--only=medium'],
      expect: 'red',
      message: /GATE RED: medium \(2 medium tests is below the floor of 50\)/,
      prepare: withFile('test-floors.json', '{"small": 6, "medium": 50, "large": 1}'),
    },
    {
      // The fixture runs in parallel (the preset's default); the controller counts. Before the preset sent each test's
      // tier with its report, a medium test counted as small there and the tier read "ran zero medium tests".
      name: 'xdist: a report that reaches the controller without its tier is counted small, the medium tier is red',
      plant: [],
      command: [...gatesPyRun, '--only=medium'],
      expect: 'red',
      message: /GATE RED: medium \(ran zero medium tests\)/,
      prepare: (f) => {
        const file = join(f, 'tests/conftest.py')
        const before = readFileSync(file, 'utf8')
        writeFileSync(
          file,
          before +
            '\n\n@pytest.hookimpl(wrapper=True)\ndef pytest_runtest_makereport(item, call):\n    report = yield\n    del report.preset_marks\n    return report\n',
        )
        return () => writeFileSync(file, before)
      },
    },
  ],
}
cases.pytest = { fixture: pytestFixture, cases: pytestCases }
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
      copyFileSync(join(here, 'violations', stack === 'gates' ? 'vitest' : stack === 'gates-pytest' ? 'pytest' : stack, p.from), to)
      planted.push(to)
    }
    undo = c.prepare?.(plan.fixture)
    const [cmd, ...args] = c.command
    const r = spawnSync(cmd, args, { cwd: plan.fixture, encoding: 'utf8', env: process.env })
    const out = `${r.stdout}\n${r.stderr}`.replace(/\u001b\[[0-9;]*m/g, '')
    const statusOk = c.exit !== undefined ? r.status === c.exit : c.expect === 'red' ? r.status !== 0 : r.status === 0
    const matched = c.message.test(out)
    const extra = c.after?.(plan.fixture)
    const ok = statusOk && matched && !extra
    if (!ok) bad++
    const first = out.split('\n').find((l) => /GATE (RED|GREEN|SKIPPED)|Error:|\[test-preset\] (FAIL|FLAKY)|exited|test-gates:/.test(l))
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
