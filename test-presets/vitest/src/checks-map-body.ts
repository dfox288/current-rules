// The body of the shape test of `checks.map.yml` version 2, one `it` in every repo. Kept apart from `checks-map-test.ts`,
// which registers it when imported: the plugin expands a test file that is only that import into an `it` with this body.
import { execFileSync } from 'node:child_process'
import { expect } from 'vitest'
import { checksMapProblems, readRepoFiles } from './checks-map.js'

export function checksMapTest(): void {
  // the map sits in the repo's root; a Vitest project may run from a folder below it (lookout's `web/`)
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const files = readRepoFiles(root)
  // control: an empty list would fail every glob, for the wrong reason
  expect(files.tracked).toContain('checks.map.yml')
  expect(files.tracked).toContain('checks.kinds.yml')
  expect(checksMapProblems(files)).toEqual([])
}
