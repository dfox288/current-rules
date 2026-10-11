import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    const setup = buildOnce(() => new Promise<void>(() => {}), { timeoutMs: 200, inProcess: true })
    await expect(setup()).rejects.toThrow(/e2e build did not finish within 0\.2 s/)
    expect(process.stdout.write).toBe(stdout)
  })
  it('control: a build that finishes resolves and leaves no timer behind', async () => {
    await expect(buildOnce(async () => {}, { timeoutMs: 60_000, inProcess: true })()).resolves.toBeUndefined()
  })
})

describe('buildOnce: the build runs in a child process', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  // A global setup module as an app writes it: `export default buildOnce(...)`. The build in it writes where it ran;
  // the function the test passes to `buildOnce` in the test process is never what runs.
  const setupModule = (dir: string, body: string) => {
    const file = join(dir, 'global-setup.mjs')
    writeFileSync(
      file,
      `import { writeFileSync } from 'node:fs'\n` +
        `import { buildOnce } from ${JSON.stringify(join(here, 'index.ts'))}\n` +
        `export default buildOnce(async () => {\n${body}\n})\n`,
    )
    return file
  }

  it('runs the build of the setup module in another process, with the env of the run', { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-once-child-'))
    const out = join(dir, 'out.json')
    process.env.BUILD_ONCE_TEST_ENV = 'inherited'
    try {
      const file = setupModule(
        dir,
        `writeFileSync(${JSON.stringify(out)}, JSON.stringify({ pid: process.pid, env: process.env.BUILD_ONCE_TEST_ENV }))`,
      )
      const setup = ((await import(file)) as { default: () => Promise<void> }).default
      await expect(setup()).resolves.toBeUndefined()
      const ran = JSON.parse(readFileSync(out, 'utf8'))
      expect(ran.pid).not.toBe(process.pid)
      expect(ran.env).toBe('inherited')
    } finally {
      delete process.env.BUILD_ONCE_TEST_ENV
    }
  })

  it('takes the module to run from the option when it is given', { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-once-child-'))
    const out = join(dir, 'out.txt')
    const file = setupModule(dir, `writeFileSync(${JSON.stringify(out)}, String(process.pid))`)
    await expect(buildOnce(async () => {}, { setupFile: file })()).resolves.toBeUndefined()
    expect(Number(readFileSync(out, 'utf8'))).not.toBe(process.pid)
  })

  it('a build that throws in the child rejects the setup with the build\'s output', { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-once-child-'))
    const file = setupModule(dir, `console.error('output-of-the-build'); throw new Error('boom-from-the-build')`)
    const setup = ((await import(file)) as { default: () => Promise<void> }).default
    await expect(setup()).rejects.toThrow(/e2e build failed[\s\S]*output-of-the-build[\s\S]*boom-from-the-build/)
  })

  it('puts stdout back when the child build fails', { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-once-child-'))
    const stdout = process.stdout.write
    const file = setupModule(dir, `throw new Error('boom')`)
    await expect(buildOnce(async () => {}, { setupFile: file })()).rejects.toThrow(/boom/)
    expect(process.stdout.write).toBe(stdout)
  })

  it('a child build past the limit is killed and the setup rejects', { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-once-child-'))
    const pidFile = join(dir, 'pid')
    const file = setupModule(dir, `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await new Promise(() => {})`)
    await expect(buildOnce(async () => {}, { setupFile: file, timeoutMs: 8000 })()).rejects.toThrow(/e2e build (timed out|did not finish)/)
    await expect.poll(() => alive(Number(readFileSync(pidFile, 'utf8'))), { timeout: 15_000 }).toBe(false)
  })
})

describe('runBuild: the process that runs it is stopped', () => {
  // A node process (the gate script, a Vitest main process) that is running a build and gets the signal. The build runs in
  // its own process group, so it would outlive its parent unless the parent kills the group on the way out.
  const here = dirname(fileURLToPath(import.meta.url))
  const parentOf = (dir: string, pidFile: string) => {
    const script = join(dir, 'parent.mjs')
    writeFileSync(
      script,
      `import { runBuild } from ${JSON.stringify(join(here, 'index.ts'))}\n` +
        `runBuild('sh', ['-c', 'sleep 47 & echo $! > ' + ${JSON.stringify(pidFile)} + '; wait']).catch(() => {})\n` +
        `setInterval(() => {}, 1000)\n`,
    )
    return script
  }

  it.each(['SIGTERM', 'SIGINT'] as const)('%s to the parent kills the build and what it started', { timeout: 10_000 }, async (signal) => {
    const dir = mkdtempSync(join(tmpdir(), 'run-build-parent-'))
    const pidFile = join(dir, 'pid')
    const parent = spawn(process.execPath, [parentOf(dir, pidFile)], { stdio: 'ignore' })
    await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '', { timeout: 5000 }).toBe(true)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    try {
      const closed = new Promise((resolve) => parent.once('close', resolve))
      parent.kill(signal)
      await closed
      await expect.poll(() => alive(pid), { timeout: 3000 }).toBe(false)
    } finally {
      if (alive(pid)) process.kill(pid, 'SIGKILL')
    }
  })

  it('the parent still exits on the signal (the handler does not swallow it)', { timeout: 10_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-build-parent-'))
    const pidFile = join(dir, 'pid')
    const parent = spawn(process.execPath, [parentOf(dir, pidFile)], { stdio: 'ignore' })
    await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '', { timeout: 5000 }).toBe(true)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    try {
      const closed = new Promise<string | null>((resolve) => parent.once('close', (_code, signal) => resolve(signal)))
      parent.kill('SIGTERM')
      expect(await closed).toBe('SIGTERM')
    } finally {
      if (alive(pid)) process.kill(pid, 'SIGKILL')
    }
  })
})
