#!/usr/bin/env node
import { GATE_NAMES, UsageError, loadConfig, runGates, type GateName } from './gates.js'

const usage = `usage: test-gates [--only=<gate>[,<gate>...]] [--raise-floors] [--config=<file>] [--base=<ref>] [--all]\n  gates: ${GATE_NAMES.join(', ')}`

async function main() {
  const args = process.argv.slice(2)
  let only: GateName[] | undefined
  let raiseFloors = false
  let configFile: string | undefined
  let base: string | undefined
  let all = false
  for (const arg of args) {
    if (arg.startsWith('--only=')) {
      only = arg.slice('--only='.length).split(',') as GateName[]
      for (const name of only)
        if (!GATE_NAMES.includes(name)) throw new UsageError(`unknown gate "${name}"`)
    } else if (arg === '--raise-floors') raiseFloors = true
    else if (arg.startsWith('--base=')) base = arg.slice('--base='.length)
    else if (arg === '--all') all = true
    else if (arg.startsWith('--config=')) configFile = arg.slice('--config='.length)
    else throw new UsageError(`unknown argument "${arg}"`)
  }
  const root = process.cwd()
  const { red } = await runGates(root, loadConfig(root, configFile), { only, raiseFloors, base, all })
  process.exit(red ? 1 : 0)
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`test-gates: ${error.message}\n${usage}`)
    process.exit(2)
  }
  console.error(error)
  process.exit(2)
})
