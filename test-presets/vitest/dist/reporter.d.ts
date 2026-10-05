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
    /**
     * Files (absolute) holding a test the run saw with the `medium` tag in a project that is not nuxt or e2e, whatever
     * its state: a tag-filtered or quarantined one counts. The gate checks that the static scan selected each of them.
     */
    mediumFiles: string[];
}
/**
 * `unit` is small, `nuxt` is medium (every test there boots Nuxt, an app booted in-process), `e2e` is large.
 * A test with the `medium` tag is medium in `unit` too.
 */
export declare function tierOf(project: string, tags: readonly string[]): Tier;
export declare function summarize(modules: ReadonlyArray<TestModule>): RunSummary;
export declare const testPresetReporter: {
    onTestRunEnd(modules: ReadonlyArray<TestModule>): void;
};
