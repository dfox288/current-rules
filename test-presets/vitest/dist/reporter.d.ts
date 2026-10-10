import type { TestModule } from 'vitest/node';
export type Tier = 'small' | 'medium' | 'large';
export interface RunSummary {
    files: number;
    tests: number;
    /** Skipped tests, quarantined ones included; tests the run's tag filter left out are not skips (`filtered`). */
    skipped: number;
    quarantined: number;
    /** Tests the run's `--tags-filter` excluded (the other tier's tests in a tier run). */
    filtered: number;
    /** One entry per skipped test, with the reason the gate output shows. */
    skips: {
        label: string;
        reason: string;
    }[];
    failed: number;
    /** Errors Vitest reported outside any test (a failed run setup, a rejected promise); 0 for a clean run. */
    unhandledErrors: number;
    flaky: string[];
    retriedBeyondRules: string[];
    /** tests that set a timeout above their tier's limit */
    limitRaised: string[];
    tiers: Record<Tier, {
        files: number;
        tests: number;
        protected: number;
        failed: number;
    }>;
    /**
     * Files (absolute) holding a test the run saw with the `medium` tag in a project that is not nuxt or e2e, whatever
     * its state: a tag-filtered or quarantined one counts. Reported for repos that read it; the gate script has not used it
     * since 0.6.0 (no static scan to cross-check).
     */
    mediumFiles: string[];
}
/**
 * `unit` is small, `nuxt` is medium (every test there boots Nuxt, an app booted in-process), `e2e` is large.
 * A test with the `medium` tag is medium in `unit` too.
 */
export declare function tierOf(project: string, tags: readonly string[]): Tier;
export declare function summarize(modules: ReadonlyArray<TestModule>, unhandledErrors?: ReadonlyArray<unknown>, tagsFilter?: readonly string[]): RunSummary;
export declare const testPresetReporter: {
    tagsFilter: readonly string[];
    onInit(vitest: {
        config?: {
            tagsFilter?: string[];
        };
    }): void;
    onTestRunEnd(modules: ReadonlyArray<TestModule>, unhandledErrors?: ReadonlyArray<unknown>): void;
};
