/** The steps of `selection.md`, "Narrowing steps per toolchain": a toolchain is added there when it has an import graph. */
export declare const NARROW_STEPS: readonly ["vitest-related"];
export interface RepoFiles {
    /** `checks.map.yml`, parsed; undefined when the file is missing or empty. */
    map: unknown;
    /** `checks.kinds.yml`, parsed. */
    kinds: unknown;
    /** Every tracked file, relative to the repo root. */
    tracked: string[];
    /** Files that could not be read or parsed. */
    unreadable?: string[];
}
/** The two files and the tracked files of the repository at `root`. */
export declare function readRepoFiles(root: string): RepoFiles;
/** gitignore semantics: a glob that matches a directory matches every file under it. */
export declare function globMatches(glob: string, path: string): boolean;
/** Every fault of the map, one line each. */
export declare function checksMapProblems(files: RepoFiles): string[];
