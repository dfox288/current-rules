// The Nuxt/TypeScript commit hook: Prettier and ESLint on the staged files, then an incremental typecheck. Never tests
// (they are the gate's, `testing.md`), never the network: it only runs what the repo's install put in node_modules/.bin,
// because Current runs it in a worker container without one. A partly staged file is refused by name, the way lookout's
// hook always did: Prettier rewrites the file from the working tree, so re-staging it would commit the unstaged hunks too.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const PRETTIER = /\.(js|mjs|cjs|ts|mts|cts|vue|json|css|md|ya?ml)$/;
const ESLINT = /\.(js|mjs|cjs|ts|mts|cts|vue)$/;
const TYPES = /(\.(ts|mts|cts|vue)|(^|\/)tsconfig[^/]*\.json)$/;
const seconds = (since) => `${((performance.now() - since) / 1000).toFixed(1)}s`;
function git(root, args) {
    return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}
/** Staged files (added, copied, modified, renamed) below `dir`, relative to `dir`, that still exist. */
export function stagedFiles(root, dir) {
    const r = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
    if (r.status !== 0)
        throw new Error(`git diff --cached failed: ${r.stderr}`);
    const prefix = relative(root, dir);
    return r.stdout
        .split('\0')
        .filter(Boolean)
        .filter((f) => prefix === '' || f.startsWith(`${prefix}/`))
        .map((f) => (prefix === '' ? f : f.slice(prefix.length + 1)))
        .filter((f) => existsSync(join(dir, f)));
}
function tool(dir, root, name) {
    for (const base of [dir, root]) {
        const bin = join(base, 'node_modules/.bin', name);
        if (existsSync(bin))
            return bin;
    }
}
export function runHook(opts) {
    const out = opts.stdout ?? ((s) => process.stdout.write(s));
    const err = opts.stderr ?? ((s) => process.stderr.write(s));
    const timing = process.env.PRESET_HOOK_TIMING === '1';
    const { root, dir } = opts;
    const files = stagedFiles(root, dir);
    const format = files.filter((f) => PRETTIER.test(f));
    const lint = files.filter((f) => ESLINT.test(f));
    const typed = files.some((f) => TYPES.test(f));
    if (format.length === 0 && lint.length === 0)
        return 0;
    const partly = [...new Set([...format, ...lint])].filter((f) => git(root, ['diff', '--quiet', '--', join(dir, f)]).status !== 0);
    if (partly.length > 0) {
        err(`pre-commit: partly staged (staged and unstaged changes both present), refusing the commit:\n`);
        for (const f of partly)
            err(`  ${relative(root, join(dir, f))}\n`);
        err('pre-commit: stage the rest of the file, or unstage the extra hunks, and commit again.\n');
        return 1;
    }
    const step = (name, bin, args, fail) => {
        const t = performance.now();
        const r = spawnSync(bin, args, { cwd: dir, encoding: 'utf8' });
        out(r.stdout ?? '');
        err(r.stderr ?? '');
        if (timing)
            err(`pre-commit: ${name} ${seconds(t)}\n`);
        if (r.status === 0)
            return true;
        err(`pre-commit: ${fail}\n`);
        return false;
    };
    const need = (name) => {
        const bin = tool(dir, root, name);
        if (!bin)
            err(`pre-commit: ${name} is not installed (node_modules/.bin/${name}); the hook runs offline, so install the repo's dependencies first.\n`);
        return bin;
    };
    if (format.length > 0) {
        const prettier = need('prettier');
        if (!prettier)
            return 1;
        if (!step('prettier', prettier, ['--ignore-unknown', '--write', ...format], 'prettier failed on a staged file (named above); fix it and commit again.'))
            return 1;
        const add = git(root, ['add', '--', ...format.map((f) => join(dir, f))]);
        if (add.status !== 0) {
            err(`pre-commit: git add failed: ${add.stderr}`);
            return 1;
        }
    }
    if (lint.length > 0) {
        const eslint = need('eslint');
        if (!eslint)
            return 1;
        if (!step('eslint', eslint, ['--no-warn-ignored', ...lint], 'eslint found a problem in a staged file (file and rule above); fix it and commit again.'))
            return 1;
    }
    if (typed && existsSync(join(dir, 'tsconfig.json'))) {
        const checker = tool(dir, root, 'vue-tsc') ?? tool(dir, root, 'tsc');
        if (!checker)
            return need('vue-tsc') ? 0 : 1;
        // With project references (what `nuxt prepare` writes) the build mode keeps one .tsbuildinfo per project, so a
        // second run only rechecks what changed; any other tsconfig gets one incremental file of its own.
        const references = /"references"\s*:/.test(readFileSync(join(dir, 'tsconfig.json'), 'utf8'));
        let args = ['-b', '--noEmit'];
        if (!references) {
            const cache = join(dir, 'node_modules/.cache/dfox288-pre-commit');
            mkdirSync(cache, { recursive: true });
            args = ['--noEmit', '--incremental', '--tsBuildInfoFile', join(cache, 'tsconfig.tsbuildinfo')];
        }
        if (!step('typecheck', checker, args, 'the typecheck failed (file, line and TS code above); fix it and commit again.'))
            return 1;
    }
    return 0;
}
