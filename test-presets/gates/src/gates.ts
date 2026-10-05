// The one gate script of the testing baseline. Gate names are the same for every stack:
//   lint, format, typecheck, small, medium, large, build
// lint and format run first and stop the run when red; the others run on and the summary names every red
// gate. A gate is never piped: each command is spawned directly and its exit code is the gate's result.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { DocsConfig } from './docs.js'

export type Stack = 'vitest' | 'pytest'
export type Tier = 'small' | 'medium' | 'large'

export const GATE_NAMES = ['lint', 'format', 'typecheck', 'docs', 'small', 'medium', 'large', 'build'] as const
export type GateName = (typeof GATE_NAMES)[number]
const TIERS: readonly Tier[] = ['small', 'medium', 'large']

export interface GatesConfig {
  stack: Stack
  /** Commands of the gates the repo has besides the test tiers, as argv (`["pnpm","lint"]`). */
  gates?: Partial<Record<'lint' | 'format' | 'typecheck' | 'build', string[]>>
  /** The tiers this repo has (default all three). A tier that is not listed is not run. */
  tiers?: Tier[]
  /** Vitest project names of the small/medium and large tiers (default unit+nuxt and e2e). */
  projects?: { smallMedium?: string[]; large?: string[] }
  /**
   * A tier's own command instead of the stack's (a justified difference, e.g. a repo that selects by
   * path). It must still run the preset: a run that writes no summary is red.
   */
  commands?: Partial<Record<Tier, string[]>>
  /** The docs gate (no doc the diff makes untrue): extra doc globs, ignore list, base ref. */
  docs?: DocsConfig
  /** The floors file, relative to the repo (default `test-floors.json`). */
  floors?: string
}

/** What the preset's reporter or plugin writes about one run (`TEST_PRESET_SUMMARY`). */
export interface RunSummary {
  files: number
  tests: number
  skipped: number
  quarantined: number
  failed: number
  flaky: string[]
  retriedBeyondRules: string[]
  /** `protected` is absent in a summary written by a preset older than 0.1.3. */
  tiers: Record<Tier, { files: number; tests: number; protected?: number }>
  /** Files (absolute) with a medium-tagged test the run saw, whatever its state. Absent before preset 0.2. */
  mediumFiles?: string[]
}

export type Floors = Partial<Record<Tier, number>>

export function loadConfig(root: string, file = 'gates.config.json'): GatesConfig {
  const path = join(root, file)
  if (!existsSync(path)) throw new UsageError(`no ${file} in ${root}`)
  const config = JSON.parse(readFileSync(path, 'utf8')) as GatesConfig
  if (config.stack !== 'vitest' && config.stack !== 'pytest')
    throw new UsageError(`gates.config.json: "stack" must be "vitest" or "pytest"`)
  return config
}

export class UsageError extends Error {}

/** One run of a tier. `list`, when set, is the static scan whose files the run is restricted to. */
export interface TierRun {
  argv: string[]
  list?: string[]
}

/**
 * The runs that make up a tier. Stack-specific, one place. A Vitest tag filter cannot say "everything in
 * the nuxt project, plus the medium-tagged tests of the others", so the nuxt project (every test there boots Nuxt, so
 * the preset counts it medium) runs on its own in the medium tier, and the small tier leaves it out. Run and count
 * then agree. A `commands` override and the pytest stack are one run.
 *
 * Vitest filters tags only after a file is collected, so `--tags-filter=medium` alone sets up every file of the
 * project (hundreds in a big app) to run a few. The medium run of the tag-selected projects therefore carries a
 * `list`: `vitest list --tags-filter medium --json` parses the files statically (Vitest 5), and the run is
 * restricted to those files. The run keeps its `--tags-filter`, so a file that also holds untagged tests still
 * counts only the medium ones. The small run is not scanned: it would save the setup of the few medium files only,
 * and a file whose tests are all generated (`it.each`) is invisible to the scan and would silently drop out of it.
 */
export function tierRuns(config: GatesConfig, tier: Tier): TierRun[] {
  const own = config.commands?.[tier]
  if (own) return [{ argv: own }]
  if (config.stack === 'vitest') {
    const base = ['pnpm', 'exec', 'vitest', 'run']
    const projects = (names: string[]) => names.flatMap((p) => ['--project', p])
    if (tier === 'large') return [{ argv: [...base, ...projects(config.projects?.large ?? ['e2e'])] }]
    const smallMedium = config.projects?.smallMedium ?? ['unit', 'nuxt']
    const nuxt = smallMedium.filter((p) => p === 'nuxt')
    const others = smallMedium.filter((p) => p !== 'nuxt')
    const runs: TierRun[] = []
    if (others.length > 0)
      runs.push({
        argv: [
          ...base,
          ...projects(others),
          '--tags-filter',
          tier === 'small' ? '!medium' : 'medium',
          ...(nuxt.length > 0 ? ['--passWithNoTests'] : []),
        ],
        ...(tier === 'medium'
          ? { list: ['pnpm', 'exec', 'vitest', 'list', '--tags-filter', 'medium', ...projects(others), '--json'] }
          : {}),
      })
    if (tier === 'medium' && nuxt.length > 0) runs.push({ argv: [...base, ...projects(nuxt)] })
    return runs
  }
  const marker =
    tier === 'small' ? 'not medium and not large' : tier === 'medium' ? 'medium' : 'large'
  return [{ argv: ['uv', 'run', '--group', 'test', 'pytest', '-m', marker] }]
}

/** The argv of each run of a tier, without the file selection. */
export function tierCommands(config: GatesConfig, tier: Tier): string[][] {
  return tierRuns(config, tier).map((r) => r.argv)
}

/**
 * The cross-check of the static scan: the files the small run saw medium-tagged tests in (it collects every file) that
 * the scan did not select, so their medium tests never ran. Sorted. `undefined` when the small run's list is not known
 * (small did not run in this invocation, a `commands.small` override, or a preset that does not write it).
 */
export function missedByScan(seen: string[] | undefined, selected: string[]): string[] | undefined {
  if (!seen) return undefined
  const chosen = new Set(selected)
  return seen.filter((f) => !chosen.has(f)).sort()
}

/**
 * The medium files the small run saw, or `undefined` when the scan cannot be cross-checked: small did not run in this
 * invocation, a `commands.small` override (its run may cover only some files), or a summary from a preset that does
 * not write `mediumFiles`. Then the medium run is not scanned: it collects every file, as it did before the scan.
 */
export function crossCheckList(config: GatesConfig, small: RunSummary | undefined): string[] | undefined {
  if (config.commands?.small) return undefined
  return small?.mediumFiles
}

export type Selection = { files: string[] } | { error: string }

/**
 * Runs a `vitest list --json` command and returns the files it names, absolute, once each, sorted. Never
 * guesses: a command that cannot start, exits non-zero or prints something else is an `error` with the reason.
 */
export function selectFiles(list: string[], cwd: string): Selection {
  const r = spawnSync(list[0], list.slice(1), { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const shown = list.join(' ')
  if (r.error) return { error: `vitest list failed: could not start ${shown}: ${r.error.message}` }
  if (r.status !== 0) {
    const reason = (r.stderr || r.stdout || '').split('\n').filter((l) => l.trim()).slice(0, 5).join(' | ')
    return { error: `vitest list failed: exit ${r.status ?? r.signal} from ${shown}: ${reason}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(r.stdout)
  } catch {
    return { error: `vitest list failed: no JSON on stdout of ${shown}: ${r.stdout.trim().slice(0, 200)}` }
  }
  if (!Array.isArray(parsed)) return { error: `vitest list failed: the JSON of ${shown} is not a list` }
  const files = new Set<string>()
  for (const entry of parsed) {
    const file = (entry as { file?: unknown } | null)?.file
    if (typeof file !== 'string') return { error: `vitest list failed: an entry of ${shown} has no file` }
    files.add(isAbsolute(file) ? file : resolve(cwd, file))
  }
  return { files: [...files].sort() }
}

const emptySummary = (): RunSummary => ({
  files: 0,
  tests: 0,
  skipped: 0,
  quarantined: 0,
  failed: 0,
  flaky: [],
  retriedBeyondRules: [],
  mediumFiles: [],
  tiers: {
    small: { files: 0, tests: 0, protected: 0 },
    medium: { files: 0, tests: 0, protected: 0 },
    large: { files: 0, tests: 0, protected: 0 },
  },
})

/** Adds the summaries of the runs of one tier into one. */
export function mergeSummaries(parts: RunSummary[]): RunSummary {
  const sum = (f: (s: RunSummary) => number) => parts.reduce((n, s) => n + f(s), 0)
  const tiers = {} as RunSummary['tiers']
  for (const tier of TIERS) {
    const protectedKnown = parts.every((s) => s.tiers[tier].protected !== undefined)
    tiers[tier] = {
      files: sum((s) => s.tiers[tier].files),
      tests: sum((s) => s.tiers[tier].tests),
      ...(protectedKnown ? { protected: sum((s) => s.tiers[tier].protected ?? 0) } : {}),
    }
  }
  return {
    files: sum((s) => s.files),
    tests: sum((s) => s.tests),
    skipped: sum((s) => s.skipped),
    quarantined: sum((s) => s.quarantined),
    failed: sum((s) => s.failed),
    flaky: parts.flatMap((s) => s.flaky),
    retriedBeyondRules: parts.flatMap((s) => s.retriedBeyondRules),
    tiers,
    ...(parts.every((s) => s.mediumFiles)
      ? { mediumFiles: [...new Set(parts.flatMap((s) => s.mediumFiles ?? []))].sort() }
      : {}),
  }
}

export interface GateResult {
  name: GateName
  status: 'ok' | 'failed' | 'skipped'
  seconds: number
  detail: string
  summary?: RunSummary
}

/** Judges a finished tier run against the count guard. Returns a failure text, or undefined if it holds. */
export function judgeTier(
  tier: Tier,
  exitCode: number,
  summary: RunSummary | undefined,
  floors: Floors,
): { failure?: string; detail: string } {
  if (exitCode !== 0) return { failure: `exit ${exitCode}`, detail: '' }
  if (!summary)
    return {
      failure: 'no run summary written: the preset did not run, so the count guard is NOT MEASURED',
      detail: '',
    }
  const t = summary.tiers[tier]
  const floor = floors[tier]
  const detail = `${t.tests} tests, ${t.files} files (floor ${floor ?? 'none'}), flaky ${summary.flaky.length}, quarantined ${summary.quarantined}`
  if (t.tests === 0) return { failure: `ran zero ${tier} tests`, detail }
  if (floor !== undefined && t.tests < floor)
    return { failure: `${t.tests} ${tier} tests is below the floor of ${floor}`, detail }
  return { detail }
}

/**
 * The protected count, one line per tier that ran: `<tier>: <tests> tests, <n> protected`. The numbers come from
 * the summary of the tier's own run (the tests it ran, tagged or marked `protected`), not from a second command.
 * Reported, never gated.
 */
export function protectedLines(results: GateResult[]): string[] {
  const lines: string[] = []
  for (const r of results) {
    if (!(TIERS as readonly string[]).includes(r.name) || !r.summary) continue
    const t = r.summary.tiers[r.name as Tier]
    lines.push(
      t.protected === undefined
        ? `${r.name}: ${t.tests} tests, protected not reported (preset older than 0.1.3)`
        : `${r.name}: ${t.tests} tests, ${t.protected} protected`,
    )
  }
  return lines
}

function runCommand(argv: string[], cwd: string, logPath: string, env: NodeJS.ProcessEnv): Promise<number> {
  mkdirSync(join(cwd, '.tmp', 'gates'), { recursive: true })
  const log = createWriteStream(logPath)
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const tee = (to: NodeJS.WriteStream) => (chunk: Buffer) => {
      to.write(chunk)
      log.write(chunk)
    }
    child.stdout.on('data', tee(process.stdout))
    child.stderr.on('data', tee(process.stderr))
    child.once('error', (error) => {
      process.stderr.write(`gates: could not start ${argv.join(' ')}: ${error.message}\n`)
      log.end(() => resolve(127))
    })
    child.once('close', (code, signal) => log.end(() => resolve(code ?? (signal ? 128 : 1))))
  })
}

export interface RunOptions {
  only?: GateName[]
  raiseFloors?: boolean
  /** The docs gate's base ref (default `origin/main`) and full-scan mode. */
  base?: string
  all?: boolean
  /** The docs gate's name-status list instead of a git base. */
  changes?: string
}

export function loadFloors(root: string, config: GatesConfig): Floors {
  const path = join(root, config.floors ?? 'test-floors.json')
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Floors) : {}
}

export async function runGates(root: string, config: GatesConfig, options: RunOptions = {}) {
  const floors = loadFloors(root, config)
  const tiers = config.tiers ?? [...TIERS]
  const results: GateResult[] = []
  let stop = false
  /** The medium files the small run saw, and the files the medium scan selected: the scan's cross-check. */
  let mediumSeen: string[] | undefined
  const scanned: string[] = []
  let scannedAny = false

  for (const name of GATE_NAMES) {
    if (options.only && !options.only.includes(name)) continue
    const isTier = (TIERS as readonly string[]).includes(name)
    const started = Date.now()
    const seconds = () => Math.round((Date.now() - started) / 1000)

    if (stop) {
      results.push({ name, status: 'skipped', seconds: 0, detail: 'lint or format is red' })
      continue
    }

    if (isTier) {
      const tier = name as Tier
      if (!tiers.includes(tier)) {
        results.push({ name, status: 'skipped', seconds: 0, detail: 'this repo has no such tier' })
        continue
      }
      console.log(`\n=== ${name} ===`)
      const commands = tierRuns(config, tier)
      let code = commands.length === 0 ? 1 : 0
      let selectionError: string | undefined
      const parts: RunSummary[] = []
      for (const [i, run] of commands.entries()) {
        let argv = run.argv
        if (run.list && mediumSeen === undefined) {
          console.log(
            `gates: ${name}: not scanned, the cross-check cannot run (no small run with a medium file list in this invocation): vitest collects every file`,
          )
        } else if (run.list) {
          const selection = selectFiles(run.list, root)
          if ('error' in selection) {
            console.log(`gates: ${selection.error}`)
            selectionError ??= selection.error
            continue
          }
          console.log(`gates: ${name}: vitest list selected ${selection.files.length} files`)
          scanned.push(...selection.files)
          scannedAny = true
          // Nothing selected is nothing to run: a run with no file argument would collect everything.
          if (selection.files.length === 0) {
            parts.push(emptySummary())
            continue
          }
          argv = [...argv, ...selection.files]
        }
        const suffix = commands.length > 1 ? `.${i + 1}` : ''
        const summaryPath = join(root, '.tmp', 'gates', `${name}${suffix}.summary.json`)
        rmSync(summaryPath, { force: true })
        const c = await runCommand(argv, root, join(root, '.tmp', 'gates', `${name}${suffix}.log`), {
          ...process.env,
          TEST_PRESET_SUMMARY: summaryPath,
        })
        if (c !== 0 && code === 0) code = c
        if (existsSync(summaryPath)) parts.push(JSON.parse(readFileSync(summaryPath, 'utf8')) as RunSummary)
      }
      // a run that wrote no summary leaves the tier unmeasured
      const summary = parts.length === commands.length && parts.length > 0 ? mergeSummaries(parts) : undefined
      if (tier === 'small') mediumSeen = crossCheckList(config, summary)
      let judged = selectionError
        ? { failure: selectionError, detail: '' }
        : judgeTier(tier, code, summary, floors)
      if (tier === 'medium' && scannedAny && !selectionError) {
        const missed = missedByScan(mediumSeen, scanned)
        if (missed && missed.length > 0) {
          const named = missed.map((f) => relative(root, f)).join(', ')
          const failure = `medium-tagged tests in files the static scan did not select, so they never ran: ${named}`
          judged = { failure: judged.failure ? `${judged.failure}; ${failure}` : failure, detail: judged.detail }
        } else console.log('gates: medium: the static scan selected every file the small run saw medium tests in')
      }
      results.push({
        name,
        status: judged.failure ? 'failed' : 'ok',
        seconds: seconds(),
        detail: judged.failure ?? judged.detail,
        summary,
      })
      continue
    }

    if (name === 'docs') {
      console.log(`\n=== docs ===`)
      const { runDocsGate } = await import('./docs.js') // loaded here: the unit tests run the .ts sources
      const docs = runDocsGate(root, config.docs, { base: options.base, all: options.all, changes: options.changes })
      for (const h of docs.hits) console.log(`${h.file}:${h.line}: ${h.text}`)
      results.push({ name, status: docs.ok ? 'ok' : 'failed', seconds: seconds(), detail: docs.detail })
      continue
    }

    const argv = config.gates?.[name as 'lint' | 'format' | 'typecheck' | 'build']
    if (!argv) {
      results.push({ name, status: 'skipped', seconds: 0, detail: 'not configured' })
      continue
    }
    console.log(`\n=== ${name} ===`)
    const code = await runCommand(argv, root, join(root, '.tmp', 'gates', `${name}.log`), process.env)
    results.push({ name, status: code === 0 ? 'ok' : 'failed', seconds: seconds(), detail: code === 0 ? '' : `exit ${code}` })
    if (code !== 0 && (name === 'lint' || name === 'format')) stop = true
  }

  const red = results.filter((r) => r.status === 'failed')
  const quarantined = Math.max(0, ...results.map((r) => r.summary?.quarantined ?? 0))
  const flaky = results.reduce((n, r) => n + (r.summary?.flaky.length ?? 0), 0)

  console.log('\n=== gate summary ===')
  for (const r of results) {
    const label = r.status === 'ok' ? 'OK' : r.status === 'failed' ? 'FAILED' : 'skipped'
    console.log(`  ${r.name.padEnd(10)} ${label.padEnd(8)} ${String(r.seconds).padStart(4)}s  ${r.detail}`)
  }
  for (const line of protectedLines(results)) console.log(`  ${line}`)
  for (const r of results)
    for (const label of r.summary?.flaky ?? []) console.log(`  FLAKY (passed on retry): ${label}`)
  // Nothing measured is not green.
  const ranNothing = results.every((r) => r.status === 'skipped')

  if (options.raiseFloors && red.length === 0 && !ranNothing) raiseFloors(root, config, floors, results)

  const verdict = ranNothing
    ? 'GATE RED: no gate ran'
    : red.length === 0
      ? `GATE GREEN (quarantined: ${quarantined}, flaky: ${flaky})`
      : `GATE RED: ${red.map((r) => (r.detail ? `${r.name} (${r.detail})` : r.name)).join(', ')}`
  console.log(verdict)
  return { results, red: red.length > 0 || ranNothing, verdict }
}

/** Raises a tier's floor to the count of a green run. Never lowers one: a lower floor is a decision. */
export function raiseFloors(root: string, config: GatesConfig, floors: Floors, results: GateResult[]) {
  const next: Floors = { ...floors }
  let changed = false
  for (const r of results) {
    if (r.status !== 'ok' || !r.summary || !(TIERS as readonly string[]).includes(r.name)) continue
    const tier = r.name as Tier
    const count = r.summary.tiers[tier].tests
    if (count > (next[tier] ?? 0)) {
      next[tier] = count
      changed = true
    }
  }
  if (changed) {
    writeFileSync(join(root, config.floors ?? 'test-floors.json'), JSON.stringify(next, null, 2) + '\n')
    console.log(`gates: floors raised: ${JSON.stringify(next)}`)
  }
}
