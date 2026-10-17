#!/usr/bin/env node
// The gate script: `node scripts/gates.mjs [--only=<kind>[,...]]`. Current runs every check kind of checks.kinds.yml as
// `node scripts/gates.mjs --only=<kind>`, and so does a person, a worker and CI.
//
// It wraps the testing baseline's shared gate script (`test-gates`, configured by gates.config.json) so that every check
// kind runs by its own name, with its own setup.
//   kinds   lint, typecheck. A repo that gets tests adds `test` (gates small and medium) and the others to KINDS below, as
//           the other apps' copies of this script have them (cove, beacon: scripts/gates.mjs).
//   setup   `nuxt prepare` once when .nuxt is missing (lint and typecheck read what it writes).
//   --list  prints the kind names, one per line.
// Never piped: the exit code is the verdict of the gate.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// Per kind: `prepare` (needs .nuxt), `gates` (the names `test-gates` knows it by)
const KINDS = {
  lint: { prepare: true, gates: ['lint'] },
  typecheck: { prepare: true, gates: ['typecheck'] },
}
const PRESET_GATES = ['lint', 'format', 'typecheck', 'small', 'medium', 'large', 'build']

const fail = (message) => {
  console.error(`gates: ${message}`)
  process.exit(2)
}
const run = (argv, env = process.env) => {
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', env })
  if (r.error) fail(`could not start ${argv.join(' ')}: ${r.error.message}`)
  return r.status ?? 1
}

let only
const passthrough = []
for (const arg of process.argv.slice(2)) {
  if (arg === '--list') {
    console.log(Object.keys(KINDS).join('\n'))
    process.exit(0)
  } else if (arg.startsWith('--only=')) only = arg.slice('--only='.length).split(',').filter(Boolean)
  else if (/^--(related|tests|small-tests|medium-tests|large-tests)=/.test(arg))
    fail(`${arg.split('=')[0]} is not taken yet: this repo has no test kind`)
  else if (arg.startsWith('--') && arg !== '--') passthrough.push(arg)
  else if (arg !== '--') fail(`unexpected argument "${arg}"`)
}

const names = only ?? Object.keys(KINDS)
const wanted = []
for (const name of names) {
  const kind = KINDS[name] ?? (PRESET_GATES.includes(name) ? {} : undefined)
  if (!kind) fail(`unknown kind "${name}" (kinds: ${Object.keys(KINDS).join(', ')})`)
  wanted.push({ name, kind })
}

const env = { ...process.env }
console.log(`gates: ${names.join(',')} (nuxt telemetry off: ${env.NUXT_TELEMETRY_DISABLED ?? 'unset'})`)

if (wanted.some((w) => w.kind.prepare) && !existsSync('.nuxt/tsconfig.json')) {
  const code = run(['node_modules/.bin/nuxt', 'prepare'], env)
  if (code !== 0) process.exit(code)
}

const gates = [...new Set(wanted.flatMap((w) => (KINDS[w.name] ? KINDS[w.name].gates : [w.name])))]
process.exit(run(['pnpm', 'exec', 'test-gates', `--only=${gates.join(',')}`, ...passthrough], env))
