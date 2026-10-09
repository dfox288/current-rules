// The one gate script of the testing baseline. Gate names are the same for every stack:
//   lint, format, typecheck, small, medium, large, build
// lint and format run first and stop the run when red; the others run on and the summary names every red
// gate. A gate is never piped: each command is spawned directly and its exit code is the gate's result.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
export const GATE_NAMES = ['lint', 'format', 'typecheck', 'docs', 'small', 'medium', 'large', 'build'];
const TIERS = ['small', 'medium', 'large'];
/** What a tier takes from a `Narrowing`: nothing means the tier runs whole. */
export function narrowingFor(narrowing, tier) {
    const related = tier === 'large' ? [] : (narrowing?.related ?? []);
    const tests = narrowing?.tests?.[tier] ?? [];
    return related.length > 0 || tests.length > 0 ? { related: [...new Set(related)], tests: [...new Set(tests)] } : undefined;
}
export function loadConfig(root, file = 'gates.config.json') {
    const path = join(root, file);
    if (!existsSync(path))
        throw new UsageError(`no ${file} in ${root}`);
    const config = JSON.parse(readFileSync(path, 'utf8'));
    if (config.stack !== 'vitest' && config.stack !== 'pytest')
        throw new UsageError(`gates.config.json: "stack" must be "vitest" or "pytest"`);
    return config;
}
export class UsageError extends Error {
}
/**
 * The paths a caller names, relative to `base` (the directory the gate runs in, where `gates.config.json` is), as
 * absolute paths, each once. `mustExist` refuses a path that is not a file (a test file to run); `within` refuses
 * one outside that directory (the repository: a kind's directory may sit below its root, and a path outside the kind's
 * directory then starts with `../`).
 */
export function repoPaths(base, paths, options = {}) {
    const out = new Set();
    for (const path of paths) {
        const absolute = resolve(base, path);
        if (options.within) {
            const rel = relative(options.within, absolute);
            if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
                throw new UsageError(`${path} is outside ${options.within}`);
        }
        if (options.mustExist && !isFile(absolute))
            throw new UsageError(`${path} does not exist`);
        out.add(absolute);
    }
    return [...out];
}
const isFile = (path) => existsSync(path) && statSync(path).isFile();
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
export function tierRuns(config, tier, narrowing) {
    const narrowed = narrowingFor(narrowing, tier);
    // The files a narrowed run ends with, each once: the changed files first, then the test files.
    const files = narrowed ? [...new Set([...narrowed.related, ...narrowed.tests])] : [];
    const own = config.commands?.[tier];
    if (own) {
        if (narrowed && narrowed.related.length > 0)
            throw new UsageError(`commands.${tier} is the repo's own command: it has no related step, so it cannot take --related`);
        return [{ argv: [...own, ...files] }];
    }
    if (config.stack === 'vitest') {
        // `vitest related --run <files>` runs the tests that import the files, and a test file given runs itself.
        // With test paths alone the run is `vitest run <paths>`. A narrowed run may select nothing in a project: not an error.
        const related = (narrowed?.related.length ?? 0) > 0;
        const base = related ? ['pnpm', 'exec', 'vitest', 'related', '--run'] : ['pnpm', 'exec', 'vitest', 'run'];
        const tail = narrowed ? ['--passWithNoTests', ...files] : [];
        const projects = (names) => names.flatMap((p) => ['--project', p]);
        if (tier === 'large')
            return [{ argv: [...base, ...projects(config.projects?.large ?? ['e2e']), ...tail] }];
        const smallMedium = config.projects?.smallMedium ?? ['unit', 'nuxt'];
        const nuxt = smallMedium.filter((p) => p === 'nuxt');
        const others = smallMedium.filter((p) => p !== 'nuxt');
        const runs = [];
        if (others.length > 0)
            runs.push({
                argv: [
                    ...base,
                    ...projects(others),
                    '--tags-filter',
                    tier === 'small' ? '!medium' : 'medium',
                    ...(narrowed ? [] : nuxt.length > 0 ? ['--passWithNoTests'] : []),
                    ...tail,
                ],
                ...(tier === 'medium' && !narrowed
                    ? { list: ['pnpm', 'exec', 'vitest', 'list', '--tags-filter', 'medium', ...projects(others), '--json'] }
                    : {}),
            });
        if (tier === 'medium' && nuxt.length > 0)
            runs.push({ argv: [...base, ...projects(nuxt), ...tail] });
        return runs;
    }
    if (narrowed && narrowed.related.length > 0)
        throw new UsageError('pytest has no narrowing step (selection.md): the python kind runs whole; give test paths with --tests');
    const marker = tier === 'small' ? 'not medium and not large' : tier === 'medium' ? 'medium' : 'large';
    return [{ argv: ['uv', 'run', '--group', 'test', 'pytest', '-m', marker, ...files] }];
}
/** The argv of each run of a tier, without the file selection. */
export function tierCommands(config, tier) {
    return tierRuns(config, tier).map((r) => r.argv);
}
/**
 * The cross-check of the static scan: the files the small run saw medium-tagged tests in (it collects every file) that
 * the scan did not select, so their medium tests never ran. Sorted. `undefined` when the small run's list is not known
 * (small did not run in this invocation, a `commands.small` override, or a preset that does not write it).
 */
export function missedByScan(seen, selected) {
    if (!seen)
        return undefined;
    const chosen = new Set(selected);
    return seen.filter((f) => !chosen.has(f)).sort();
}
/**
 * The medium files the small run saw, or `undefined` when the scan cannot be cross-checked: small did not run in this
 * invocation, a `commands.small` override (its run may cover only some files), or a summary from a preset that does
 * not write `mediumFiles`. Then the medium run is not scanned: it collects every file, as it did before the scan.
 */
export function crossCheckList(config, small) {
    if (config.commands?.small)
        return undefined;
    return small?.mediumFiles;
}
/**
 * Runs a `vitest list --json` command and returns the files it names, absolute, once each, sorted. Never
 * guesses: a command that cannot start, exits non-zero or prints something else is an `error` with the reason.
 */
export function selectFiles(list, cwd) {
    const r = spawnSync(list[0], list.slice(1), { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const shown = list.join(' ');
    if (r.error)
        return { error: `vitest list failed: could not start ${shown}: ${r.error.message}` };
    if (r.status !== 0) {
        const reason = (r.stderr || r.stdout || '').split('\n').filter((l) => l.trim()).slice(0, 5).join(' | ');
        return { error: `vitest list failed: exit ${r.status ?? r.signal} from ${shown}: ${reason}` };
    }
    let parsed;
    try {
        parsed = JSON.parse(r.stdout);
    }
    catch {
        return { error: `vitest list failed: no JSON on stdout of ${shown}: ${r.stdout.trim().slice(0, 200)}` };
    }
    if (!Array.isArray(parsed))
        return { error: `vitest list failed: the JSON of ${shown} is not a list` };
    const files = new Set();
    for (const entry of parsed) {
        const file = entry?.file;
        if (typeof file !== 'string')
            return { error: `vitest list failed: an entry of ${shown} has no file` };
        files.add(isAbsolute(file) ? file : resolve(cwd, file));
    }
    return { files: [...files].sort() };
}
const emptySummary = () => ({
    files: 0,
    tests: 0,
    skipped: 0,
    quarantined: 0,
    failed: 0,
    flaky: [],
    retriedBeyondRules: [],
    mediumFiles: [],
    tiers: {
        small: { files: 0, tests: 0, protected: 0 },
        medium: { files: 0, tests: 0, protected: 0 },
        large: { files: 0, tests: 0, protected: 0 },
    },
});
/** Adds the summaries of the runs of one tier into one. */
export function mergeSummaries(parts) {
    const sum = (f) => parts.reduce((n, s) => n + f(s), 0);
    const tiers = {};
    for (const tier of TIERS) {
        const protectedKnown = parts.every((s) => s.tiers[tier].protected !== undefined);
        tiers[tier] = {
            files: sum((s) => s.tiers[tier].files),
            tests: sum((s) => s.tiers[tier].tests),
            ...(protectedKnown ? { protected: sum((s) => s.tiers[tier].protected ?? 0) } : {}),
        };
    }
    return {
        files: sum((s) => s.files),
        tests: sum((s) => s.tests),
        skipped: sum((s) => s.skipped),
        quarantined: sum((s) => s.quarantined),
        failed: sum((s) => s.failed),
        flaky: parts.flatMap((s) => s.flaky),
        retriedBeyondRules: parts.flatMap((s) => s.retriedBeyondRules),
        tiers,
        ...(parts.every((s) => s.mediumFiles)
            ? { mediumFiles: [...new Set(parts.flatMap((s) => s.mediumFiles ?? []))].sort() }
            : {}),
    };
}
/**
 * Judges a finished tier run against the count guard. Returns a failure text, or undefined if it holds. A narrowed
 * run is a subset by design: the floor does not apply, and a tier in which nothing was selected is a skip with its
 * reason (`selection.md`, rule 6), not a failure.
 */
export function judgeTier(tier, exitCode, summary, floors, narrowed = false) {
    if (exitCode !== 0)
        return { failure: `exit ${exitCode}`, detail: '' };
    if (!summary)
        return {
            failure: 'no run summary written: the preset did not run, so the count guard is NOT MEASURED',
            detail: '',
        };
    const t = summary.tiers[tier];
    if (narrowed) {
        const detail = `${t.tests} tests, ${t.files} files (narrowed, floor not checked), flaky ${summary.flaky.length}, quarantined ${summary.quarantined}`;
        if (t.tests === 0)
            return { skip: `narrowed: no ${tier} test is related to the selected files`, detail };
        return { detail };
    }
    const floor = floors[tier];
    const detail = `${t.tests} tests, ${t.files} files (floor ${floor ?? 'none'}), flaky ${summary.flaky.length}, quarantined ${summary.quarantined}`;
    if (t.tests === 0)
        return { failure: `ran zero ${tier} tests`, detail };
    if (floor !== undefined && t.tests < floor)
        return { failure: `${t.tests} ${tier} tests is below the floor of ${floor}`, detail };
    return { detail };
}
/**
 * The protected count, one line per tier that ran: `<tier>: <tests> tests, <n> protected`. The numbers come from
 * the summary of the tier's own run (the tests it ran, tagged or marked `protected`), not from a second command.
 * Reported, never gated.
 */
export function protectedLines(results) {
    const lines = [];
    for (const r of results) {
        if (!TIERS.includes(r.name) || !r.summary)
            continue;
        const t = r.summary.tiers[r.name];
        lines.push(t.protected === undefined
            ? `${r.name}: ${t.tests} tests, protected not reported (preset older than 0.1.3)`
            : `${r.name}: ${t.tests} tests, ${t.protected} protected`);
    }
    return lines;
}
function runCommand(argv, cwd, logPath, env) {
    mkdirSync(join(cwd, '.tmp', 'gates'), { recursive: true });
    const log = createWriteStream(logPath);
    return new Promise((resolve) => {
        const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        const tee = (to) => (chunk) => {
            to.write(chunk);
            log.write(chunk);
        };
        child.stdout.on('data', tee(process.stdout));
        child.stderr.on('data', tee(process.stderr));
        child.once('error', (error) => {
            process.stderr.write(`gates: could not start ${argv.join(' ')}: ${error.message}\n`);
            log.end(() => resolve(127));
        });
        child.once('close', (code, signal) => log.end(() => resolve(code ?? (signal ? 128 : 1))));
    });
}
export function loadFloors(root, config) {
    const path = join(root, config.floors ?? 'test-floors.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}
export async function runGates(root, config, options = {}) {
    const floors = loadFloors(root, config);
    const tiers = config.tiers ?? [...TIERS];
    const narrowing = options.narrowing;
    if (narrowing && options.raiseFloors)
        throw new UsageError('--raise-floors raises a floor from a whole tier: not together with --related or --tests');
    // a combination that cannot run (related on pytest, on a repo's own tier command) is refused before any gate runs
    for (const tier of TIERS)
        if (tiers.includes(tier) && (!options.only || options.only.includes(tier)))
            tierRuns(config, tier, narrowing);
    const results = [];
    let stop = false;
    /** The medium files the small run saw, and the files the medium scan selected: the scan's cross-check. */
    let mediumSeen;
    const scanned = [];
    let scannedAny = false;
    for (const name of GATE_NAMES) {
        if (options.only && !options.only.includes(name))
            continue;
        const isTier = TIERS.includes(name);
        const started = Date.now();
        const seconds = () => Math.round((Date.now() - started) / 1000);
        if (stop) {
            results.push({ name, status: 'skipped', seconds: 0, detail: 'lint or format is red' });
            continue;
        }
        if (isTier) {
            const tier = name;
            if (!tiers.includes(tier)) {
                results.push({ name, status: 'skipped', seconds: 0, detail: 'this repo has no such tier' });
                continue;
            }
            console.log(`\n=== ${name} ===`);
            const commands = tierRuns(config, tier, narrowing);
            const narrowedTier = narrowingFor(narrowing, tier);
            let code = commands.length === 0 ? 1 : 0;
            let selectionError;
            const parts = [];
            for (const [i, run] of commands.entries()) {
                let argv = run.argv;
                if (run.list && mediumSeen === undefined) {
                    console.log(`gates: ${name}: not scanned, the cross-check cannot run (no small run with a medium file list in this invocation): vitest collects every file`);
                }
                else if (run.list) {
                    const selection = selectFiles(run.list, root);
                    if ('error' in selection) {
                        console.log(`gates: ${selection.error}`);
                        selectionError ??= selection.error;
                        continue;
                    }
                    console.log(`gates: ${name}: vitest list selected ${selection.files.length} files`);
                    scanned.push(...selection.files);
                    scannedAny = true;
                    // Nothing selected is nothing to run: a run with no file argument would collect everything.
                    if (selection.files.length === 0) {
                        parts.push(emptySummary());
                        continue;
                    }
                    argv = [...argv, ...selection.files];
                }
                const suffix = commands.length > 1 ? `.${i + 1}` : '';
                const summaryPath = join(root, '.tmp', 'gates', `${name}${suffix}.summary.json`);
                rmSync(summaryPath, { force: true });
                const c = await runCommand(argv, root, join(root, '.tmp', 'gates', `${name}${suffix}.log`), {
                    ...process.env,
                    TEST_PRESET_SUMMARY: summaryPath,
                });
                // pytest exits 5 when it collected nothing: in a narrowed run that is "no test selected", judged below
                const exit = narrowedTier && config.stack === 'pytest' && !config.commands?.[tier] && c === 5 ? 0 : c;
                if (exit !== 0 && code === 0)
                    code = exit;
                if (existsSync(summaryPath))
                    parts.push(JSON.parse(readFileSync(summaryPath, 'utf8')));
            }
            // a run that wrote no summary leaves the tier unmeasured
            const summary = parts.length === commands.length && parts.length > 0 ? mergeSummaries(parts) : undefined;
            if (tier === 'small')
                mediumSeen = crossCheckList(config, summary);
            let judged = selectionError
                ? { failure: selectionError, detail: '' }
                : judgeTier(tier, code, summary, floors, narrowedTier !== undefined);
            if (tier === 'medium' && scannedAny && !selectionError) {
                const missed = missedByScan(mediumSeen, scanned);
                if (missed && missed.length > 0) {
                    const named = missed.map((f) => relative(root, f)).join(', ');
                    const failure = `medium-tagged tests in files the static scan did not select, so they never ran: ${named}`;
                    judged = { failure: judged.failure ? `${judged.failure}; ${failure}` : failure, detail: judged.detail };
                }
                else
                    console.log('gates: medium: the static scan selected every file the small run saw medium tests in');
            }
            if (judged.skip && narrowedTier) {
                const named = narrowedTier.related.map((f) => relative(root, f)).join(', ');
                console.log(`gates: ${name}: ${judged.skip}${named ? ` (changed files: ${named})` : ''}`);
            }
            results.push({
                name,
                status: judged.failure ? 'failed' : judged.skip ? 'skipped' : 'ok',
                seconds: seconds(),
                detail: judged.failure ?? judged.skip ?? judged.detail,
                summary,
                ...(narrowedTier ? { narrowed: true } : {}),
            });
            continue;
        }
        if (name === 'docs') {
            console.log(`\n=== docs ===`);
            const { runDocsGate } = await import('./docs.js'); // loaded here: the unit tests run the .ts sources
            const docs = runDocsGate(root, config.docs, { base: options.base, all: options.all, changes: options.changes });
            for (const h of docs.hits)
                console.log(`${h.file}:${h.line}: ${h.text}`);
            results.push({ name, status: docs.ok ? 'ok' : 'failed', seconds: seconds(), detail: docs.detail });
            continue;
        }
        const argv = config.gates?.[name];
        if (!argv) {
            results.push({ name, status: 'skipped', seconds: 0, detail: 'not configured' });
            continue;
        }
        console.log(`\n=== ${name} ===`);
        const code = await runCommand(argv, root, join(root, '.tmp', 'gates', `${name}.log`), process.env);
        results.push({ name, status: code === 0 ? 'ok' : 'failed', seconds: seconds(), detail: code === 0 ? '' : `exit ${code}` });
        if (code !== 0 && (name === 'lint' || name === 'format'))
            stop = true;
    }
    const red = results.filter((r) => r.status === 'failed');
    const quarantined = Math.max(0, ...results.map((r) => r.summary?.quarantined ?? 0));
    const flaky = results.reduce((n, r) => n + (r.summary?.flaky.length ?? 0), 0);
    console.log('\n=== gate summary ===');
    for (const r of results) {
        const label = r.status === 'ok' ? 'OK' : r.status === 'failed' ? 'FAILED' : 'skipped';
        console.log(`  ${r.name.padEnd(10)} ${label.padEnd(8)} ${String(r.seconds).padStart(4)}s  ${r.detail}`);
    }
    for (const line of protectedLines(results))
        console.log(`  ${line}`);
    for (const r of results)
        for (const label of r.summary?.flaky ?? [])
            console.log(`  FLAKY (passed on retry): ${label}`);
    // Nothing measured is not green.
    const ranNothing = results.every((r) => r.status === 'skipped' && !r.narrowed);
    if (options.raiseFloors && red.length === 0 && !ranNothing)
        raiseFloors(root, config, floors, results);
    // A narrowed run in which every narrowed tier selected nothing and nothing is red: no test ran (exit 66, selection.md
    // "The gate script's arguments"). A mixed run, one tier skipped and another green, stays green.
    const tierResults = results.filter((r) => TIERS.includes(r.name));
    const noTestRan = !ranNothing && red.length === 0 && tierResults.some((r) => r.narrowed) && tierResults.every((r) => r.status === 'skipped');
    const verdict = ranNothing
        ? 'GATE RED: no gate ran'
        : red.length === 0
            ? noTestRan
                ? 'GATE SKIPPED: narrowed run, no tier selected a test'
                : `GATE GREEN (quarantined: ${quarantined}, flaky: ${flaky})`
            : `GATE RED: ${red.map((r) => (r.detail ? `${r.name} (${r.detail})` : r.name)).join(', ')}`;
    console.log(verdict);
    return { results, red: red.length > 0 || ranNothing, noTestRan, verdict };
}
/** Raises a tier's floor to the count of a green run. Never lowers one: a lower floor is a decision. */
export function raiseFloors(root, config, floors, results) {
    const next = { ...floors };
    let changed = false;
    for (const r of results) {
        if (r.status !== 'ok' || r.narrowed || !r.summary || !TIERS.includes(r.name))
            continue;
        const tier = r.name;
        const count = r.summary.tiers[tier].tests;
        if (count > (next[tier] ?? 0)) {
            next[tier] = count;
            changed = true;
        }
    }
    if (changed) {
        writeFileSync(join(root, config.floors ?? 'test-floors.json'), JSON.stringify(next, null, 2) + '\n');
        console.log(`gates: floors raised: ${JSON.stringify(next)}`);
    }
}
