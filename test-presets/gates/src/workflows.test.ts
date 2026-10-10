// current-rules' own workflows run where the app repos' do (D-462): the runner variable, GitHub-hosted until it is set.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const workflows = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.github', 'workflows')
const EXPECTED = "runs-on: ${{ vars.RUNNER_ANY || 'ubuntu-latest' }}"

test('every job of every workflow uses the runner expression', () => {
  const files = readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))
  assert.ok(files.length >= 2, `found ${files.length} workflow files in ${workflows}`)
  let jobs = 0
  for (const file of files)
    for (const line of readFileSync(join(workflows, file), 'utf8').split('\n')) {
      if (!/^\s*runs-on:/.test(line)) continue
      jobs++
      assert.equal(line.trim(), EXPECTED, `${file}: ${line.trim()}`)
    }
  assert.ok(jobs >= 3, `found ${jobs} runs-on lines`)
})
