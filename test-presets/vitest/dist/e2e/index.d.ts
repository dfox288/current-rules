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
 * Vitest puts no time limit on a global setup (the hook timeout is for tests and their hooks), so the limit is here:
 * `runBuild` kills a build past its own limit, and `buildOnce` rejects when the function has not finished within
 * `timeoutMs` (default 15 minutes). A rejection fails the run before any e2e file. For a build function that is not
 * `runBuild`, the rejection cannot stop the work it started.
 */
export declare function buildOnce(build: () => Promise<void>, options?: {
    timeoutMs?: number;
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
