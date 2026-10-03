// The count guard, the retry guard and the flaky report. Registered by `plugin.ts` for every run, so
// it also runs when a worker passes `--reporter=...` (that flag replaces the config's reporters).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LIMITS, PROJECTS, SUMMARY_ENV } from './constants.js';
/** `unit` and `nuxt` are small, a test there with the `medium` tag is medium, `e2e` is large. */
export function tierOf(project, tags) {
    if (project === PROJECTS.e2e)
        return 'large';
    return tags.includes('medium') ? 'medium' : 'small';
}
export function summarize(modules) {
    const summary = {
        files: 0,
        tests: 0,
        skipped: 0,
        quarantined: 0,
        failed: 0,
        flaky: [],
        retriedBeyondRules: [],
        limitRaised: [],
        tiers: {
            small: { files: 0, tests: 0, protected: 0 },
            medium: { files: 0, tests: 0, protected: 0 },
            large: { files: 0, tests: 0, protected: 0 },
        },
    };
    const filesPerTier = {
        small: new Set(),
        medium: new Set(),
        large: new Set(),
    };
    const files = new Set();
    for (const module of modules) {
        for (const test of module.children.allTests()) {
            const state = test.result().state;
            const label = `${module.relativeModuleId} > ${test.fullName}`;
            if (state === 'skipped') {
                summary.skipped++;
                if (test.tags.includes('quarantine'))
                    summary.quarantined++;
                continue;
            }
            if (state === 'pending')
                continue;
            const tier = tierOf(test.project.name, test.tags);
            summary.tests++;
            summary.tiers[tier].tests++;
            if (test.tags.includes('protected'))
                summary.tiers[tier].protected++;
            files.add(module.moduleId);
            filesPerTier[tier].add(module.moduleId);
            if (state === 'failed')
                summary.failed++;
            const retries = test.diagnostic()?.retryCount ?? 0;
            const maxRetries = tier === 'large' ? 1 : 0;
            if (retries > maxRetries)
                summary.retriedBeyondRules.push(`${label} (${tier} tier, retried ${retries}x)`);
            // The tier's limit is fixed (pytest refuses a test's own timeout too). A test may lower it.
            const own = test.options.timeout;
            if (typeof own === 'number' && own > LIMITS[tier])
                summary.limitRaised.push(`${label} (${tier} tier, ${own} ms > ${LIMITS[tier]} ms)`);
            if (state === 'passed' && test.diagnostic()?.flaky)
                summary.flaky.push(label);
        }
    }
    summary.files = files.size;
    for (const tier of Object.keys(filesPerTier))
        summary.tiers[tier].files = filesPerTier[tier].size;
    return summary;
}
export const testPresetReporter = {
    onTestRunEnd(modules) {
        const s = summarize(modules);
        const t = s.tiers;
        process.stdout.write(`[test-preset] ran ${s.files} files, ${s.tests} tests ` +
            `(small ${t.small.tests}, medium ${t.medium.tests}, large ${t.large.tests}); ` +
            `skipped ${s.skipped}, quarantined ${s.quarantined}, flaky ${s.flaky.length}\n`);
        for (const label of s.flaky)
            process.stdout.write(`[test-preset] FLAKY (passed on retry, not a clean pass): ${label}\n`);
        for (const label of s.retriedBeyondRules) {
            process.stdout.write(`[test-preset] FAIL: retry beyond the baseline's rules: ${label}\n`);
            process.exitCode = 1;
        }
        for (const label of s.limitRaised) {
            process.stdout.write(`[test-preset] FAIL: sets its own timeout above the tier's limit: ${label}\n`);
            process.exitCode = 1;
        }
        const path = process.env[SUMMARY_ENV];
        if (path) {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, JSON.stringify(s, null, 2));
        }
    },
};
