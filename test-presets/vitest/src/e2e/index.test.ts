import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildOnce, runBuild } from './index.js'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('runBuild', () => {
  it('rejects with the command and the limit when the build runs past it, and the build is gone', { timeout: 5000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-build-'))
    const pidFile = join(dir, 'pid')
    // the build starts a child of its own and waits for it: killing the shell alone would leave `sleep` running
    await expect(
      runBuild('sh', ['-c', `sleep 60 & echo $! > ${pidFile}; wait`], { timeoutMs: 300 }),
    ).rejects.toThrow(/e2e build timed out after 0\.3 s: sh -c/)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await expect.poll(() => alive(pid), { timeout: 3000 }).toBe(false)
  })
  it('control: a build inside its limit resolves', async () => {
    await expect(runBuild('node', ['-e', '0'], { timeoutMs: 5000 })).resolves.toBeUndefined()
  })
  it('control: a failing build still rejects with its output', async () => {
    await expect(runBuild('node', ['-e', 'console.error("boom"); process.exit(3)'])).rejects.toThrow(/exited 3[\s\S]*boom/)
  })
  it('has a limit when none is given', () => {
    expect(runBuild.defaultTimeoutMs).toBeGreaterThan(0)
    expect(runBuild.defaultTimeoutMs).toBeLessThanOrEqual(30 * 60_000)
  })
})

describe('buildOnce', () => {
  it('rejects when the build function does not finish in time, and puts stdout back', { timeout: 5000 }, async () => {
    const stdout = process.stdout.write
    const setup = buildOnce(() => new Promise<void>(() => {}), { timeoutMs: 200 })
    await expect(setup()).rejects.toThrow(/e2e build did not finish within 0\.2 s/)
    expect(process.stdout.write).toBe(stdout)
  })
  it('control: a build that finishes resolves and leaves no timer behind', async () => {
    await expect(buildOnce(async () => {}, { timeoutMs: 60_000 })()).resolves.toBeUndefined()
  })
})
