#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { GATE_NAMES, UsageError, loadConfig, repoPaths, runGates, type GateName, type Narrowing, type Tier } from './gates.js'

const usage = `usage: test-gates [--only=<gate>[,<gate>...]] [--raise-floors] [--config=<file>] [--base=<ref>] [--changes=<file>] [--all]
                  [--related=<file>]... [--tests=<file>]... [--small-tests=<file>]... [--medium-tests=<file>]... [--large-tests=<file>]...
  gates: ${GATE_NAMES.join(', ')}
  --related: a changed file for \`vitest related\` (small and medium of a Vitest kind); --tests: a test file to run, in every tier of this run,
  --<tier>-tests: in that tier only. Paths are relative to the directory the gate runs in
  (a file outside it starts with ../); repeat the flag per file. Exit: 0 green; 1 red; 2 usage error; 66 a narrowed run
  in which no tier ran a test and nothing is red (on a run without --related or --tests, 66 never happens).`

/** Exit code of a narrowed run that selected no test. */
const NO_TEST_RAN = 66

const TIERS: Tier[] = ['small', 'medium', 'large']

/** The value of a `--flag=value` argument; an empty one is a usage error, not "no files". */
function pathValue(arg: string): string {
  const value = arg.slice(arg.indexOf('=') + 1)
  if (value === '') throw new UsageError(`${arg} names no file`)
  return value
}

/** The git top level (a kind's directory may sit below it), else the directory itself. */
function repoRoot(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return cwd
  }
}

async function main() {
  const args = process.argv.slice(2)
  let only: GateName[] | undefined
  let raiseFloors = false
  let configFile: string | undefined
  let base: string | undefined
  let all = false
  let changes: string | undefined
  const related: string[] = []
  const tests: Record<Tier, string[]> = { small: [], medium: [], large: [] }
  for (const arg of args) {
    if (arg.startsWith('--only=')) {
      only = arg.slice('--only='.length).split(',') as GateName[]
      for (const name of only)
        if (!GATE_NAMES.includes(name)) throw new UsageError(`unknown gate "${name}"`)
    } else if (arg === '--raise-floors') raiseFloors = true
    else if (arg.startsWith('--base=')) base = arg.slice('--base='.length)
    else if (arg.startsWith('--changes=')) changes = arg.slice('--changes='.length)
    else if (arg === '--all') all = true
    else if (arg.startsWith('--config=')) configFile = arg.slice('--config='.length)
    else if (arg.startsWith('--related=')) related.push(pathValue(arg))
    else if (arg.startsWith('--tests=')) for (const tier of TIERS) tests[tier].push(pathValue(arg))
    else if (/^--(small|medium|large)-tests=/.test(arg)) tests[arg.slice(2, arg.indexOf('-tests=')) as Tier].push(pathValue(arg))
    else throw new UsageError(`unknown argument "${arg}"`)
  }
  const root = process.cwd()
  const narrowing: Narrowing = {}
  if (related.length > 0) narrowing.related = repoPaths(root, related)
  const named = TIERS.filter((tier) => tests[tier].length > 0)
  if (named.length > 0)
    narrowing.tests = Object.fromEntries(named.map((tier) => [tier, repoPaths(root, tests[tier], { mustExist: true, within: repoRoot(root) })]))
  const narrowed = narrowing.related !== undefined || narrowing.tests !== undefined
  const { red, noTestRan } = await runGates(root, loadConfig(root, configFile), { only, raiseFloors, base, all, changes, ...(narrowed ? { narrowing } : {}) })
  // 66: a narrowed run in which no tier ran a test and nothing is red (selection.md, "The gate script's arguments")
  process.exit(red ? 1 : noTestRan ? NO_TEST_RAN : 0)
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`test-gates: ${error.message}\n${usage}`)
    process.exit(2)
  }
  console.error(error)
  process.exit(2)
})
