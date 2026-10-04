export type Stack = 'vitest' | 'pytest';
export type Tier = 'small' | 'medium' | 'large';
export declare const GATE_NAMES: readonly ["lint", "format", "typecheck", "small", "medium", "large", "build"];
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
}
export type Floors = Partial<Record<Tier, number>>;
export declare function loadConfig(root: string, file?: string): GatesConfig;
export declare class UsageError extends Error {
}
/**
 * The argv of each run that makes up a tier. Stack-specific, one place. A Vitest tag filter cannot say "everything in
 * the nuxt project, plus the medium-tagged tests of the others", so the nuxt project (every test there boots Nuxt, so
 * the preset counts it medium) runs on its own in the medium tier, and the small tier leaves it out. Run and count
 * then agree. A `commands` override and the pytest stack are one run.
 */
export declare function tierCommands(config: GatesConfig, tier: Tier): string[][];
/** Adds the summaries of the runs of one tier into one. */
export declare function mergeSummaries(parts: RunSummary[]): RunSummary;
export interface GateResult {
    name: GateName;
    status: 'ok' | 'failed' | 'skipped';
    seconds: number;
    detail: string;
    summary?: RunSummary;
}
/** Judges a finished tier run against the count guard. Returns a failure text, or undefined if it holds. */
export declare function judgeTier(tier: Tier, exitCode: number, summary: RunSummary | undefined, floors: Floors): {
    failure?: string;
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
}
export declare function loadFloors(root: string, config: GatesConfig): Floors;
export declare function runGates(root: string, config: GatesConfig, options?: RunOptions): Promise<{
    results: GateResult[];
    red: boolean;
    verdict: string;
}>;
/** Raises a tier's floor to the count of a green run. Never lowers one: a lower floor is a decision. */
export declare function raiseFloors(root: string, config: GatesConfig, floors: Floors, results: GateResult[]): void;
