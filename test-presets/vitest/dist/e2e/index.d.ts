/** A port nothing listens on, found by binding `127.0.0.1` (never `listen(0)` without a host). */
export declare function freePort(): Promise<number>;
/**
 * Runs a command to completion in the foreground; its output is shown only when it fails. It is bounded: past
 * `timeoutMs` (default 10 minutes) the command and everything it started are killed and the promise rejects.
 */
export declare function runBuild(command: string, args: string[], options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
}): Promise<void>;
export declare namespace runBuild {
    var defaultTimeoutMs: number;
}
/**
 * The global setup of the `e2e` project: `export default buildOnce(() => runBuild('pnpm', ['build']))`.
 * Vitest runs it once per run, before the first `e2e` file, and only when the run selects an `e2e`
 * file. It puts back what a build tool may leave wrapped (stdout, stderr, console): left wrapped,
 * the reporter's output after the hook is lost (cove#60).
 *
 * The build runs in a child process, not in the Vitest main process: a build that runs in-process (Nuxt's `loadNuxt` and
 * `buildNuxt`, Vite, Nitro) leaves its module graph in the main process's heap for the rest of the run (cove#287: about
 * 2.4 GiB of a 5 GiB peak, idle while the tests ran). The child loads the module that called `buildOnce` (found from the
 * call stack, or `setupFile`) through Vite's SSR loader and runs its default export, so the `build` that runs is the one
 * written in that module, with the environment of the run, and the process (and its heap) is gone when the build is done.
 * The build's output is shown only when it fails, as `runBuild` does. The module is loaded without the repo's Vite
 * config, so it must not rely on an alias or plugin of it. `inProcess: true` runs `build` in the main process, as 0.6.0
 * did; so does a call whose module cannot be found (a note on stderr says so).
 *
 * Vitest puts no time limit on a global setup (the hook timeout is for tests and their hooks), so the limit is here:
 * `runBuild` kills a build past its own limit, and `buildOnce` rejects when the function has not finished within
 * `timeoutMs` (default 15 minutes); the child, with everything it started, is killed at the same limit. A rejection
 * fails the run before any e2e file. For an in-process build function that is not `runBuild`, the rejection cannot stop
 * the work it started.
 */
export declare function buildOnce(build: () => Promise<void>, options?: {
    timeoutMs?: number;
    inProcess?: boolean;
    setupFile?: string;
}): () => Promise<void>;
export interface BuiltApp {
    origin: string;
    port: number;
    stop(): Promise<void>;
}
/**
 * Starts the built output as a process on `127.0.0.1` and a free port (`PORT`, `NITRO_PORT`, `HOST`,
 * `NITRO_HOST` are set), and polls `readyPath` until it answers, up to `timeoutMs`.
 */
export declare function startBuiltApp(options: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    readyPath?: string;
    timeoutMs?: number;
}): Promise<BuiltApp>;
