// Helpers for the `e2e` project (tier large): the build-once global setup and a server for the built
// output. The browser helper is `./browser`.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
/** A port nothing listens on, found by binding `127.0.0.1` (never `listen(0)` without a host). */
export function freePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}
/** Runs a command to completion in the foreground; its output is shown only when it fails. */
export function runBuild(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (d) => (output += d));
        child.stderr.on('data', (d) => (output += d));
        child.once('error', reject);
        child.once('close', (code) => code === 0
            ? resolve()
            : reject(new Error(`e2e build failed: ${command} ${args.join(' ')} exited ${code}\n${output}`)));
    });
}
/**
 * The global setup of the `e2e` project: `export default buildOnce(() => runBuild('pnpm', ['build']))`.
 * Vitest runs it once per run, before the first `e2e` file, and only when the run selects an `e2e`
 * file. It puts back what a build tool may leave wrapped (stdout, stderr, console): left wrapped,
 * the reporter's output after the hook is lost (cove#60).
 */
export function buildOnce(build) {
    return async function setup() {
        const stdout = process.stdout.write;
        const stderr = process.stderr.write;
        const consoleMethods = { ...console };
        try {
            await build();
        }
        finally {
            process.stdout.write = stdout;
            process.stderr.write = stderr;
            Object.assign(console, consoleMethods);
        }
    };
}
/**
 * Starts the built output as a process on `127.0.0.1` and a free port (`PORT`, `NITRO_PORT`, `HOST`,
 * `NITRO_HOST` are set), and polls `readyPath` until it answers, up to `timeoutMs`.
 */
export async function startBuiltApp(options) {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
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
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    let exited = null;
    child.once('close', (code) => (exited = code ?? -1));
    const stop = async () => {
        if (exited !== null)
            return;
        child.kill('SIGTERM');
        await new Promise((resolve) => child.once('close', () => resolve()));
    };
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);
    while (Date.now() < deadline) {
        if (exited !== null)
            throw new Error(`built app exited ${exited} before it answered\n${output}`);
        try {
            await fetch(origin + (options.readyPath ?? '/'));
            return { origin, port, stop };
        }
        catch {
            await new Promise((r) => setTimeout(r, 100)); // a poll with a limit, not a sleep for a result
        }
    }
    await stop();
    throw new Error(`built app did not answer ${origin} in time\n${output}`);
}
