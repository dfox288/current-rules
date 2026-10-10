// The count guard, the retry guard and the flaky report. Registered by `plugin.ts` for every run, so
// it also runs when a worker passes `--reporter=...` (that flag replaces the config's reporters).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LIMITS, PROJECTS, SUMMARY_ENV } from './constants.js';
/**
 * `unit` is small, `nuxt` is medium (every test there boots Nuxt, an app booted in-process), `e2e` is large.
 * A test with the `medium` tag is medium in `unit` too.
 */
export function tierOf(project, tags) {
    if (project === PROJECTS.e2e)
        return 'large';
    if (project === PROJECTS.nuxt)
        return 'medium';
    return tags.includes('medium') ? 'medium' : 'small';
}
/**
 * Whether `--tags-filter` left a test out. Vitest marks such a test skipped like any other, so the reporter evaluates the
 * two expressions the gate script passes (`medium`, `!medium`) itself. Any other expression is not read: `undefined`.
 */
function excludedBy(filter, tags) {
    let excluded = false;
    for (const expression of filter) {
        const match = /^(!?)([A-Za-z0-9_-]+)$/.exec(expression.trim());
        if (!match)
            return undefined;
        if (tags.includes(match[2]) === (match[1] === '!'))
            excluded = true;
    }
    return excluded;
}
function skipReason(test) {
    const note = test.result().note;
    if (note)
        return note;
    if (test.tags.includes('quarantine'))
        return 'quarantined (quarantine tag)';
    if (test.task?.mode === 'todo')
        return 'todo (it.todo)';
    return 'no reason given (it.skip, skipIf, runIf or ctx.skip() without text)';
}
export function summarize(modules, unhandledErrors = [], tagsFilter = []) {
    const summary = {
        files: 0,
        tests: 0,
        skipped: 0,
        quarantined: 0,
        filtered: 0,
        skips: [],
        failed: 0,
        unhandledErrors: unhandledErrors.length,
        flaky: [],
        retriedBeyondRules: [],
        limitRaised: [],
        mediumFiles: [],
        tiers: {
            small: { files: 0, tests: 0, protected: 0, failed: 0 },
            medium: { files: 0, tests: 0, protected: 0, failed: 0 },
            large: { files: 0, tests: 0, protected: 0, failed: 0 },
        },
    };
    const filesPerTier = {
        small: new Set(),
        medium: new Set(),
        large: new Set(),
    };
    const files = new Set();
    const mediumFiles = new Set();
    for (const module of modules) {
        for (const test of module.children.allTests()) {
            if (test.tags.includes('medium') &&
                test.project.name !== PROJECTS.nuxt &&
                test.project.name !== PROJECTS.e2e)
                mediumFiles.add(module.moduleId);
            const state = test.result().state;
            const label = `${module.relativeModuleId} > ${test.fullName}`;
            if (state === 'skipped') {
                if (excludedBy(tagsFilter, test.tags)) {
                    summary.filtered++;
                    continue;
                }
                summary.skipped++;
                if (test.tags.includes('quarantine'))
                    summary.quarantined++;
                summary.skips.push({ label, reason: skipReason(test) });
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
            if (state === 'failed') {
                summary.failed++;
                summary.tiers[tier].failed++;
            }
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
    summary.mediumFiles = [...mediumFiles].sort();
    for (const tier of Object.keys(filesPerTier))
        summary.tiers[tier].files = filesPerTier[tier].size;
    return summary;
}
export const testPresetReporter = {
    tagsFilter: [],
    onInit(vitest) {
        this.tagsFilter = vitest.config?.tagsFilter ?? [];
    },
    onTestRunEnd(modules, unhandledErrors = []) {
        const s = summarize(modules, unhandledErrors, this.tagsFilter);
        const t = s.tiers;
        process.stdout.write(`[test-preset] ran ${s.files} files, ${s.tests} tests ` +
            `(small ${t.small.tests}, medium ${t.medium.tests}, large ${t.large.tests}); ` +
            `skipped ${s.skipped}, quarantined ${s.quarantined}, flaky ${s.flaky.length}\n`);
        // A run that executed no file and hit an error outside the tests (a project setup Vitest refuses, say) measured
        // nothing. Vitest exits 1 for it, but not under `--dangerouslyIgnoreUnhandledErrors`, and a gate that reads
        // "0 tests" as a narrowed skip would pass it: red here, in every path.
        if (s.files === 0 && s.unhandledErrors > 0) {
            const message = String(unhandledErrors[0]?.message ?? unhandledErrors[0]);
            process.stdout.write(`[test-preset] FAIL: the run executed 0 files and hit ${s.unhandledErrors} unhandled error${s.unhandledErrors === 1 ? '' : 's'}; the first: ${message.split('\n')[0]}\n`);
            process.exitCode = 1;
        }
        for (const skip of s.skips)
            process.stdout.write(`[test-preset] SKIPPED: ${skip.label} (${skip.reason})\n`);
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
