import type { TestModule } from 'vitest/node';
export type Tier = 'small' | 'medium' | 'large';
export interface RunSummary {
    files: number;
    tests: number;
    skipped: number;
    quarantined: number;
    failed: number;
    flaky: string[];
    retriedBeyondRules: string[];
    /** tests that set a timeout above their tier's limit */
    limitRaised: string[];
    tiers: Record<Tier, {
        files: number;
        tests: number;
        protected: number;
    }>;
}
/** `unit` and `nuxt` are small, a test there with the `medium` tag is medium, `e2e` is large. */
export declare function tierOf(project: string, tags: readonly string[]): Tier;
export declare function summarize(modules: ReadonlyArray<TestModule>): RunSummary;
export declare const testPresetReporter: {
    onTestRunEnd(modules: ReadonlyArray<TestModule>): void;
};
