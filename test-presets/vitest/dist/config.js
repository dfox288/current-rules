import { fileURLToPath } from 'node:url';
import { GROUP_ORDER, LIMITS, PROJECTS, TAGS } from './constants.js';
import { testPresetPlugin } from './plugin.js';
// `process.env.TZ` is read by the workers the run spawns; set it before any of them exist. The
// projects' `env` repeats it for pools that build a fresh environment.
process.env.TZ = 'UTC';
const setupFile = (name) => fileURLToPath(new URL(`./setup/${name}.js`, import.meta.url));
/** Test options a repo may not set: the preset's value is the baseline. */
const RESERVED = ['tags', 'retry', 'testTimeout', 'strictTags', 'name', 'projects', 'reporters'];
function checkDifferences(project, input) {
    const extra = input.test ?? {};
    const keys = Object.keys(extra);
    if (keys.length > 0 && !input.justification?.trim())
        throw new Error(`test preset: project "${project}" passes test options (${keys.join(', ')}) without a justification`);
    for (const key of keys)
        if (RESERVED.includes(key))
            throw new Error(`test preset: project "${project}" sets "${key}", which the baseline fixes (limits are hard, retries and tags are the preset's)`);
    const env = (extra.env ?? {});
    if ('TZ' in env)
        throw new Error(`test preset: project "${project}" sets TZ, the baseline is UTC`);
}
function common(name, input) {
    checkDifferences(name, input);
    const { env, setupFiles, sequence, ...rest } = (input.test ?? {});
    const groupOrder = GROUP_ORDER[name];
    if (sequence && 'groupOrder' in sequence && sequence.groupOrder !== groupOrder)
        throw new Error(`test preset: project "${name}" sets "sequence.groupOrder", which the preset fixes (unit and nuxt 0, e2e 1); drop it`);
    return {
        base: {
            name,
            tags: TAGS,
            include: input.include,
            exclude: input.exclude,
            env: { ...env, TZ: 'UTC' },
            ...rest,
            sequence: { ...sequence, groupOrder },
        },
        setupFiles: setupFiles ?? [],
    };
}
function vitePart(input) {
    return {
        plugins: [testPresetPlugin(), ...(input.plugins ?? [])],
        resolve: input.resolve,
        define: input.define,
    };
}
export async function defineTestConfig(options) {
    const projects = [];
    if (options.unit) {
        const { base, setupFiles } = common(PROJECTS.unit, options.unit);
        projects.push({
            ...vitePart(options.unit),
            test: {
                ...base,
                retry: 0,
                testTimeout: LIMITS.small,
                setupFiles: [setupFile('common'), setupFile('small-guards'), ...setupFiles],
            },
        });
    }
    if (options.nuxt) {
        const { defineVitestProject } = await import('@nuxt/test-utils/config');
        const { base, setupFiles } = common(PROJECTS.nuxt, options.nuxt);
        projects.push(await defineVitestProject({
            ...vitePart(options.nuxt),
            test: {
                environment: 'nuxt',
                ...base,
                retry: 0,
                testTimeout: LIMITS.small,
                setupFiles: [setupFile('common'), setupFile('small-guards'), ...setupFiles],
            },
        }));
    }
    if (options.e2e) {
        const { base, setupFiles } = common(PROJECTS.e2e, options.e2e);
        // the input's globalSetup first, then one a repo passed through `test:` (kept, not overwritten)
        const globalSetup = [...(options.e2e.globalSetup ?? []), ...(base.globalSetup ?? [])];
        projects.push({
            ...vitePart(options.e2e),
            test: {
                ...base,
                retry: 1,
                testTimeout: LIMITS.large,
                hookTimeout: options.e2e.hookTimeout,
                ...(globalSetup.length > 0 ? { globalSetup } : {}),
                setupFiles: [setupFile('common'), ...setupFiles],
            },
        });
    }
    if (projects.length === 0)
        throw new Error('test preset: no project given (unit, nuxt, e2e)');
    return {
        test: {
            projects: projects,
            ...(options.coverage ? { coverage: options.coverage } : {}),
        },
    };
}
