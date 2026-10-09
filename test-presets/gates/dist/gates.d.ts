import type { DocsConfig } from './docs.js';
export type Stack = 'vitest' | 'pytest';
export type Tier = 'small' | 'medium' | 'large';
export declare const GATE_NAMES: readonly ["lint", "format", "typecheck", "docs", "small", "medium", "large", "build"];
export type GateName = (typeof GATE_NAMES)[number];
export interface GatesConfig {
    stack: Stack;
    /** Commands of the gates the repo has besides the test tiers, as argv (`["pnpm","lint"]`). */
    gates?: Partial<Record<'lint' | 'format' | 'typecheck' | 'build', string[]>>;
    /** The tiers this repo has (default all three). A tier that is not listed is not run. */
    tiers?: Tier[];
    /** Vitest project names of the small/medium and large tiers (default unit+nuxt and e2e). */
    projects?: {
        smallMedium?: string[];
        large?: string[];
    };
    /**
     * A tier's own command instead of the stack's (a justified difference, e.g. a repo that selects by
     * path). It must still run the preset: a run that writes no summary is red.
     */
    commands?: Partial<Record<Tier, string[]>>;
    /** The docs gate (no doc the diff makes untrue): extra doc globs, ignore list, base ref. */
    docs?: DocsConfig;
    /** The floors file, relative to the repo (default `test-floors.json`). */
    floors?: string;
}
/** What the preset's reporter or plugin writes about one run (`TEST_PRESET_SUMMARY`). */
export interface RunSummary {
    files: number;
    tests: number;
    skipped: number;
    quarantined: number;
    failed: number;
    flaky: string[];
    retriedBeyondRules: string[];
    /** `protected` is absent in a summary written by a preset older than 0.1.3. */
    tiers: Record<Tier, {
        files: number;
        tests: number;
        protected?: number;
    }>;
    /** Files (absolute) with a medium-tagged test the run saw, whatever its state. Absent before preset 0.2. */
    mediumFiles?: string[];
}
export type Floors = Partial<Record<Tier, number>>;
/**
 * A narrowed run (`selection.md`, rules 5 and 6), given by the caller that did the selecting. Absolute paths.
 * `related` is the kind's changed files for the Vitest `related` step (`narrow: vitest-related`); `tests` are the
 * test files to run, per tier. A tier with neither runs whole. `related` never applies to the large tier: e2e has no
 * narrowing step (`selection.md`, "Narrowing steps per toolchain").
 */
export interface Narrowing {
    related?: string[];
    tests?: Partial<Record<Tier, string[]>>;
}
/** What a tier takes from a `Narrowing`: nothing means the tier runs whole. */
export declare function narrowingFor(narrowing: Narrowing | undefined, tier: Tier): {
    related: string[];
    tests: string[];
} | undefined;
export declare function loadConfig(root: string, file?: string): GatesConfig;
export declare class UsageError extends Error {
}
/**
 * The paths a caller names, relative to `base` (the directory the gate runs in, where `gates.config.json` is), as
 * absolute paths, each once. `mustExist` refuses a path that is not a file (a test file to run); `within` refuses
 * one outside that directory (the repository: a kind's directory may sit below its root, and a path outside the kind's
 * directory then starts with `../`).
 */
export declare function repoPaths(base: string, paths: string[], options?: {
    mustExist?: boolean;
    within?: string;
}): string[];
/** One run of a tier. `list`, when set, is the static scan whose files the run is restricted to. */
export interface TierRun {
    argv: string[];
    list?: string[];
}
/**
 * The runs that make up a tier. Stack-specific, one place. A Vitest tag filter cannot say "everything in
 * the nuxt project, plus the medium-tagged tests of the others", so the nuxt project (every test there boots Nuxt, so
 * the preset counts it medium) runs on its own in the medium tier, and the small tier leaves it out. Run and count
 * then agree. A `commands` override and the pytest stack are one run.
 *
 * Vitest filters tags only after a file is collected, so `--tags-filter=medium` alone sets up every file of the
 * project (hundreds in a big app) to run a few. The medium run of the tag-selected projects therefore carries a
 * `list`: `vitest list --tags-filter medium --json` parses the files statically (Vitest 5), and the run is
 * restricted to those files. The run keeps its `--tags-filter`, so a file that also holds untagged tests still
 * counts only the medium ones. The small run is not scanned: it would save the setup of the few medium files only,
 * and a file whose tests are all generated (`it.each`) is invisible to the scan and would silently drop out of it.
 *
 * A narrowed tier (`narrowing`, see `Narrowing`) runs the files it was given and is not scanned: the file set is
 * already small, and the cross-check needs a whole small run.
 */
export declare function tierRuns(config: GatesConfig, tier: Tier, narrowing?: Narrowing): TierRun[];
/** The argv of each run of a tier, without the file selection. */
export declare function tierCommands(config: GatesConfig, tier: Tier): string[][];
/**
 * The cross-check of the static scan: the files the small run saw medium-tagged tests in (it collects every file) that
 * the scan did not select, so their medium tests never ran. Sorted. `undefined` when the small run's list is not known
 * (small did not run in this invocation, a `commands.small` override, or a preset that does not write it).
 */
export declare function missedByScan(seen: string[] | undefined, selected: string[]): string[] | undefined;
/**
 * The medium files the small run saw, or `undefined` when the scan cannot be cross-checked: small did not run in this
 * invocation, a `commands.small` override (its run may cover only some files), or a summary from a preset that does
 * not write `mediumFiles`. Then the medium run is not scanned: it collects every file, as it did before the scan.
 */
export declare function crossCheckList(config: GatesConfig, small: RunSummary | undefined): string[] | undefined;
export type Selection = {
    files: string[];
} | {
    error: string;
};
/**
 * Runs a `vitest list --json` command and returns the files it names, absolute, once each, sorted. Never
 * guesses: a command that cannot start, exits non-zero or prints something else is an `error` with the reason.
 */
export declare function selectFiles(list: string[], cwd: string): Selection;
/** Adds the summaries of the runs of one tier into one. */
export declare function mergeSummaries(parts: RunSummary[]): RunSummary;
export interface GateResult {
    name: GateName;
    status: 'ok' | 'failed' | 'skipped';
    seconds: number;
    detail: string;
    summary?: RunSummary;
    /** A narrowed tier: it ran a subset, so it is neither a floor nor a reason for "no gate ran". */
    narrowed?: boolean;
}
/**
 * Judges a finished tier run against the count guard. Returns a failure text, or undefined if it holds. A narrowed
 * run is a subset by design: the floor does not apply, and a tier in which nothing was selected is a skip with its
 * reason (`selection.md`, rule 6), not a failure.
 */
export declare function judgeTier(tier: Tier, exitCode: number, summary: RunSummary | undefined, floors: Floors, narrowed?: boolean): {
    failure?: string;
    skip?: string;
    detail: string;
};
/**
 * The protected count, one line per tier that ran: `<tier>: <tests> tests, <n> protected`. The numbers come from
 * the summary of the tier's own run (the tests it ran, tagged or marked `protected`), not from a second command.
 * Reported, never gated.
 */
export declare function protectedLines(results: GateResult[]): string[];
export interface RunOptions {
    only?: GateName[];
    raiseFloors?: boolean;
    /** The docs gate's base ref (default `origin/main`) and full-scan mode. */
    base?: string;
    all?: boolean;
    /** The docs gate's name-status list instead of a git base. */
    changes?: string;
    /** A narrowed run: the files `selection.md` picked for the kind. A tier without files runs whole. */
    narrowing?: Narrowing;
}
export declare function loadFloors(root: string, config: GatesConfig): Floors;
export declare function runGates(root: string, config: GatesConfig, options?: RunOptions): Promise<{
    results: GateResult[];
    red: boolean;
    noTestRan: boolean;
    verdict: string;
}>;
/** Raises a tier's floor to the count of a green run. Never lowers one: a lower floor is a decision. */
export declare function raiseFloors(root: string, config: GatesConfig, floors: Floors, results: GateResult[]): void;
