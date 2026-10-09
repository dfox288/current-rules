export interface HookOptions {
    /** The git top level. */
    root: string;
    /** The project directory (where `node_modules` and `tsconfig.json` are): `root`, or a folder below it. */
    dir: string;
    stdout?: (s: string) => void;
    stderr?: (s: string) => void;
}
/** Staged files (added, copied, modified, renamed) below `dir`, relative to `dir`, that still exist. */
export declare function stagedFiles(root: string, dir: string): string[];
export declare function runHook(opts: HookOptions): number;
