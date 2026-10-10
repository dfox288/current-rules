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
    /** Tests the run's tag filter left out, not counted in `skipped`; absent before preset 0.6.0. */
    filtered?: number;
    /** One entry per skipped test with its reason; absent before preset 0.6.0. */
    skips?: {
        label: string;
        reason: string;
    }[];
    failed: number;
    /** Errors outside any test (a project setup Vitest refuses). Absent in a summary written by a preset older than 0.6.0. */
    unhandledErrors?: number;
    flaky: string[];
    retriedBeyondRules: string[];
    /** Tests that set their own timeout above their tier's limit; absent before preset 0.6.0. */
    limitRaised?: string[];
    /** `protected` is absent in a summary written by a preset older than 0.1.3, `failed` in one older than 0.6.0. */
    tiers: Record<Tier, {
        files: number;
        tests: number;
        protected?: number;
        failed?: number;
    }>;
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
/** One run of a tier. */
export interface TierRun {
    argv: string[];
}
/**
 * The runs that make up a tier when it runs alone (`--only=small`, `--only=medium`). Stack-specific, one place. A Vitest
 * tag filter cannot say "everything in the nuxt project, plus the medium-tagged tests of the others", so the nuxt
 * project (every test there boots Nuxt, so the preset counts it medium) runs on its own in the medium tier, and the
 * small tier leaves it out. Run and count then agree. A `commands` override and the pytest stack are one run.
 *
 * When small and medium both run in one invocation, a Vitest repo does not use these: `combinedRun` runs them in one
 * Vitest process, so the files of the project are collected and set up once.
 *
 * A narrowed tier (`narrowing`, see `Narrowing`) runs the files it was given: the file set is already small.
 */
export declare function tierRuns(config: GatesConfig, tier: Tier, narrowing?: Narrowing): TierRun[];
/** The argv of each run of a tier, without the file selection. */
export declare function tierCommands(config: GatesConfig, tier: Tier): string[][];
/**
 * Small and medium in one Vitest process. The preset's reporter tells the tiers apart (the `nuxt` project and the
 * medium-tagged tests of the others are medium, the rest small), so one run with no tag filter gives both counts, and
 * the files of the unit project are collected and set up once instead of once per tier. `undefined` when the tiers
 * cannot share a run: not Vitest, a repo's own tier command, no project, or tiers narrowed to different files.
 */
export declare function combinedRun(config: GatesConfig, narrowing: Narrowing | undefined): string[] | undefined;
/**
 * The exit code a tier answers for out of a run it shares with another tier. A test that failed names its tier; a limit
 * or retry breach names its tier in its label; a red exit nothing explains (a file that did not load, an unhandled
 * error) is every tier's. A summary without per-tier failures (a preset older than 0.6.0) cannot attribute: red for all.
 */
export declare function tierExit(summary: RunSummary | undefined, tier: Tier, exit: number): number;
/**
 * One line per skipped test with its reason. A summary without the list (a preset older than 0.6.0) gets one line that
 * says how many skips have no reason on record.
 */
export declare function skipLines(summaries: RunSummary[]): string[];
/** Adds the summaries of the runs of one tier into one. */
export declare function mergeSummaries(parts: RunSummary[]): RunSummary;
/**
 * Reads a run summary the preset wrote. Never throws: a file that is not JSON, or not the shape of a summary, is an
 * `error` with the reason, so the tier is red and the GATE verdict line is still printed.
 */
export declare function readSummary(path: string): {
    summary: RunSummary;
} | {
    error: string;
};
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
