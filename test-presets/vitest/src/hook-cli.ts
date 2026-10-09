#!/usr/bin/env node
// `dfox288-pre-commit [--dir <folder>]`: the Nuxt/TypeScript commit hook for the project in <folder> (default: the git top
// level). A repo wires it as `.githooks/pre-commit` (`exec pnpm exec dfox288-pre-commit`) or points core.hooksPath at
// node_modules/@dfox288/test-preset-vitest/hooks.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { runHook } from './hook.js'

const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
if (top.status !== 0) {
  process.stderr.write('pre-commit: not inside a git repository\n')
  process.exit(1)
}
const root = realpathSync(top.stdout.trim())
const flag = process.argv.indexOf('--dir')
const given = flag >= 0 ? process.argv[flag + 1] : process.env.PRESET_HOOK_DIR
if (flag >= 0 && !given) {
  process.stderr.write('pre-commit: --dir needs a folder\n')
  process.exit(2)
}
const dir = given ? realpathSync(resolve(root, given)) : root
if (dir !== root && !dir.startsWith(`${root}/`)) {
  process.stderr.write(`pre-commit: ${dir} is not inside ${root}\n`)
  process.exit(2)
}
process.exit(runHook({ root, dir }))
