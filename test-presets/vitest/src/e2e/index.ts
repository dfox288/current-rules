// Helpers for the `e2e` project (tier large): the build-once global setup and a server for the built
// output. The browser helper is `./browser`.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

/** A port nothing listens on, found by binding `127.0.0.1` (never `listen(0)` without a host). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

/** How long `runBuild` lets a build run when the caller gives no limit. */
const BUILD_TIMEOUT_MS = 10 * 60_000

const seconds = (ms: number) => String(Math.round(ms / 100) / 10)

/**
 * Runs a command to completion in the foreground; its output is shown only when it fails. It is bounded: past
 * `timeoutMs` (default 10 minutes) the command and everything it started are killed and the promise rejects.
 */
export function runBuild(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    // its own process group, so the limit can kill what the build started and not only the shell around it
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let output = ''
    let timedOut = false
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-(child.pid as number), signal)
      } catch {
        // already gone
      }
    }
    // The build is in its own group, so it would outlive this process (Ctrl-C on the gate, Current killing it on its
    // timeout): kill the group on the way out. A signal handler turns off the signal's default, so re-raise it.
    const onExit = () => killGroup('SIGKILL')
    const onSignal = (signal: NodeJS.Signals) => {
      onExit()
      release()
      process.kill(process.pid, signal)
    }
    const signals = ['SIGINT', 'SIGTERM'] as const
    const release = () => {
      process.removeListener('exit', onExit)
      for (const signal of signals) process.removeListener(signal, onSignal)
    }
    process.once('exit', onExit)
    for (const signal of signals) process.once(signal, onSignal)
    const limit = setTimeout(() => {
      timedOut = true
      killGroup('SIGTERM')
      setTimeout(() => killGroup('SIGKILL'), 5000).unref()
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(limit)
      release()
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(limit)
      release()
      if (timedOut)
        reject(new Error(`e2e build timed out after ${seconds(timeoutMs)} s: ${command} ${args.join(' ')} (killed)\n${output}`))
      else if (code === 0) resolve()
      else reject(new Error(`e2e build failed: ${command} ${args.join(' ')} exited ${code}\n${output}`))
    })
  })
}
runBuild.defaultTimeoutMs = BUILD_TIMEOUT_MS

/**
 * The global setup of the `e2e` project: `export default buildOnce(() => runBuild('pnpm', ['build']))`.
 * Vitest runs it once per run, before the first `e2e` file, and only when the run selects an `e2e`
 * file. It puts back what a build tool may leave wrapped (stdout, stderr, console): left wrapped,
 * the reporter's output after the hook is lost (cove#60).
 *
 * Vitest puts no time limit on a global setup (the hook timeout is for tests and their hooks), so the limit is here:
 * `runBuild` kills a build past its own limit, and `buildOnce` rejects when the function has not finished within
 * `timeoutMs` (default 15 minutes). A rejection fails the run before any e2e file. For a build function that is not
 * `runBuild`, the rejection cannot stop the work it started.
 */
export function buildOnce(build: () => Promise<void>, options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS * 1.5
  return async function setup(): Promise<void> {
    const stdout = process.stdout.write
    const stderr = process.stderr.write
    const consoleMethods = { ...console }
    let limit: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        build(),
        new Promise<never>((_, reject) => {
          limit = setTimeout(() => reject(new Error(`e2e build did not finish within ${seconds(timeoutMs)} s`)), timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(limit)
      process.stdout.write = stdout
      process.stderr.write = stderr
      Object.assign(console, consoleMethods)
    }
  }
}

export interface BuiltApp {
  origin: string
  port: number
  stop(): Promise<void>
}

/**
 * Starts the built output as a process on `127.0.0.1` and a free port (`PORT`, `NITRO_PORT`, `HOST`,
 * `NITRO_HOST` are set), and polls `readyPath` until it answers, up to `timeoutMs`.
 */
export async function startBuiltApp(options: {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  readyPath?: string
  timeoutMs?: number
}): Promise<BuiltApp> {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1',
      PORT: String(port),
      NITRO_PORT: String(port),
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  let exited: number | null = null
  child.once('close', (code) => (exited = code ?? -1))

  const stop = async () => {
    if (exited !== null) return
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => child.once('close', () => resolve()))
  }

  const deadline = Date.now() + (options.timeoutMs ?? 15_000)
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`built app exited ${exited} before it answered\n${output}`)
    try {
      await fetch(origin + (options.readyPath ?? '/'))
      return { origin, port, stop }
    } catch {
      await new Promise((r) => setTimeout(r, 100)) // a poll with a limit, not a sleep for a result
    }
  }
  await stop()
  throw new Error(`built app did not answer ${origin} in time\n${output}`)
}
