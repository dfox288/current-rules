import { appendFileSync, mkdirSync } from 'node:fs'
import { buildOnce, runBuild } from '@dfox288/test-preset-vitest/e2e'

export default buildOnce(async () => {
  // A line per build: the break-it "no e2e file selected, no build" reads this file.
  mkdirSync('.tmp', { recursive: true })
  appendFileSync('.tmp/e2e-build-ran', `${new Date().toISOString()}\n`)
  await runBuild('pnpm', ['exec', 'nuxt', 'build'])
})
