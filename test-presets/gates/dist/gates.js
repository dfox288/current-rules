// The one gate script of the testing baseline. Gate names are the same for every stack:
//   lint, format, typecheck, small, medium, large, build
// lint and format run first and stop the run when red; the others run on and the summary names every red
// gate. A gate is never piped: each command is spawned directly and its exit code is the gate's result.
import { spawn } from 'node:child_process';
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
 * Small and medium in one Vitest process. The preset's reporter tells the tiers apart (the `nuxt` project and the
 * medium-tagged tests of the others are medium, the rest small), so one run with no tag filter gives both counts, and
 * the files of the unit project are collected and set up once instead of once per tier. `undefined` when the tiers
 * cannot share a run: not Vitest, a repo's own tier command, no project, or tiers narrowed to different files.
 */
export function combinedRun(config, narrowing) {
    if (config.stack !== 'vitest' || config.commands?.small || config.commands?.medium)
        return undefined;
    const projects = config.projects?.smallMedium ?? ['unit', 'nuxt'];
    if (projects.length === 0)
        return undefined;
    const small = narrowingFor(narrowing, 'small');
    const medium = narrowingFor(narrowing, 'medium');
    const same = (a = [], b = []) => a.length === b.length && a.every((f) => b.includes(f));
    if (small || medium) {
        if (!small || !medium || !same(small.related, medium.related) || !same(small.tests, medium.tests))
            return undefined;
    }
    const related = (small?.related.length ?? 0) > 0;
    const files = small ? [...new Set([...small.related, ...small.tests])] : [];
    return [
        'pnpm', 'exec', 'vitest', ...(related ? ['related', '--run'] : ['run']),
        ...projects.flatMap((p) => ['--project', p]),
        ...(small ? ['--passWithNoTests', ...files] : []),
    ];
}
/**
 * The exit code a tier answers for out of a run it shares with another tier. A test that failed names its tier; a limit
 * or retry breach names its tier in its label; a red exit nothing explains (a file that did not load, an unhandled
 * error) is every tier's. A summary without per-tier failures (a preset older than 0.6.0) cannot attribute: red for all.
 */
export function tierExit(summary, tier, exit) {
    if (exit === 0 || !summary)
        return exit;
    const failed = ['small', 'medium'].map((t) => summary.tiers[t].failed); // the tiers a shared run covers
    if (failed.some((n) => n === undefined))
        return exit;
    if (failed.every((n) => n === 0))
        return exit;
    if ((summary.tiers[tier].failed ?? 0) > 0)
        return exit;
    const named = (labels = []) => labels.some((l) => l.includes(`(${tier} tier`));
    return named(summary.retriedBeyondRules) || named(summary.limitRaised) ? exit : 0;
}
/**
 * One line per skipped test with its reason. A summary without the list (a preset older than 0.6.0) gets one line that
 * says how many skips have no reason on record.
 */
export function skipLines(summaries) {
    const lines = [];
    const seen = new Set();
    for (const x of summaries) {
        if (!x.skips) {
            if (x.skipped > 0)
                lines.push(`${x.skipped} skipped, no reasons on record (the preset that ran is older than 0.6.0)`);
            continue;
        }
        for (const skip of x.skips) {
            // one physical line each: a reason with a line break could forge a summary line
            const line = `SKIPPED: ${skip.label} (${skip.reason})`.replace(/\s+/g, ' ');
            if (!seen.has(line))
                lines.push(line);
            seen.add(line);
        }
    }
    return lines;
}
/** Adds the summaries of the runs of one tier into one. */
export function mergeSummaries(parts) {
    const sum = (f) => parts.reduce((n, s) => n + f(s), 0);
    const tiers = {};
    for (const tier of TIERS) {
        const protectedKnown = parts.every((s) => s.tiers[tier].protected !== undefined);
        const failedKnown = parts.every((s) => s.tiers[tier].failed !== undefined);
        tiers[tier] = {
            files: sum((s) => s.tiers[tier].files),
            tests: sum((s) => s.tiers[tier].tests),
            ...(protectedKnown ? { protected: sum((s) => s.tiers[tier].protected ?? 0) } : {}),
            ...(failedKnown ? { failed: sum((s) => s.tiers[tier].failed ?? 0) } : {}),
        };
    }
    return {
        files: sum((s) => s.files),
        tests: sum((s) => s.tests),
        skipped: sum((s) => s.skipped),
        quarantined: sum((s) => s.quarantined),
        filtered: sum((s) => s.filtered ?? 0),
        ...(parts.every((s) => s.skips) ? { skips: parts.flatMap((s) => s.skips ?? []) } : {}),
        failed: sum((s) => s.failed),
        unhandledErrors: sum((s) => s.unhandledErrors ?? 0),
        flaky: parts.flatMap((s) => s.flaky),
        retriedBeyondRules: parts.flatMap((s) => s.retriedBeyondRules),
        ...(parts.every((s) => s.limitRaised) ? { limitRaised: parts.flatMap((s) => s.limitRaised ?? []) } : {}),
        tiers,
    };
}
/**
 * Reads a run summary the preset wrote. Never throws: a file that is not JSON, or not the shape of a summary, is an
 * `error` with the reason, so the tier is red and the GATE verdict line is still printed.
 */
export function readSummary(path) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (error) {
        return { error: `the run summary ${path} is not valid JSON (${error.message}): the count guard is NOT MEASURED` };
    }
    const tiers = parsed?.tiers;
    if (!tiers || !TIERS.every((t) => typeof tiers[t]?.tests === 'number'))
        return { error: `the run summary ${path} has no tier counts: the count guard is NOT MEASURED` };
    return { summary: parsed };
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
    // Nothing was measured: the run never got to its files. Red even when the runner exited 0 and a narrowed run would skip.
    if (summary.files === 0 && (summary.unhandledErrors ?? 0) > 0)
        return {
            failure: `the run executed 0 files and hit ${summary.unhandledErrors} unhandled error${summary.unhandledErrors === 1 ? '' : 's'} (see the ${tier} log)`,
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
    /** Runs one command with its own log and summary; a summary that cannot be read is an `error`, never a crash. */
    const execute = async (argv, file) => {
        const summaryPath = join(root, '.tmp', 'gates', `${file}.summary.json`);
        rmSync(summaryPath, { force: true });
        const code = await runCommand(argv, root, join(root, '.tmp', 'gates', `${file}.log`), {
            ...process.env,
            TEST_PRESET_SUMMARY: summaryPath,
        });
        let summary;
        let error;
        if (existsSync(summaryPath)) {
            const read = readSummary(summaryPath);
            if ('error' in read) {
                console.log(`gates: ${read.error}`);
                error = read.error;
            }
            else
                summary = read.summary;
        }
        return { code, summary, error };
    };
    /** Judges a tier against the count guard and records the gate. */
    const finishTier = (tier, code, summary, error, seconds) => {
        const narrowedTier = narrowingFor(narrowing, tier);
        const judged = error
            ? { failure: error, detail: '' }
            : judgeTier(tier, code, summary, floors, narrowedTier !== undefined);
        if (judged.skip && narrowedTier) {
            const named = narrowedTier.related.map((f) => relative(root, f)).join(', ');
            console.log(`gates: ${tier}: ${judged.skip}${named ? ` (changed files: ${named})` : ''}`);
        }
        results.push({
            name: tier,
            status: judged.failure ? 'failed' : judged.skip ? 'skipped' : 'ok',
            seconds,
            detail: judged.failure ?? judged.skip ?? judged.detail,
            summary,
            ...(narrowedTier ? { narrowed: true } : {}),
        });
    };
    // Small and medium asked for together on a Vitest repo: one process, the counts split by tier from its summary.
    const both = tiers.includes('small') && tiers.includes('medium') && (!options.only || (options.only.includes('small') && options.only.includes('medium')));
    const combined = both ? combinedRun(config, narrowing) : undefined;
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
            if (combined && tier === 'medium')
                continue; // judged with small, from the same run
            if (combined && tier === 'small') {
                console.log('\n=== small, medium (one Vitest process) ===');
                const ran = await execute(combined, 'small-medium');
                const secs = seconds();
                for (const t of ['small', 'medium'])
                    finishTier(t, tierExit(ran.summary, t, ran.code), ran.summary, ran.error, secs);
                continue;
            }
            console.log(`\n=== ${name} ===`);
            const commands = tierRuns(config, tier, narrowing);
            const narrowedTier = narrowingFor(narrowing, tier);
            let code = commands.length === 0 ? 1 : 0;
            let summaryError;
            const parts = [];
            for (const [i, run] of commands.entries()) {
                const ran = await execute(run.argv, `${name}${commands.length > 1 ? `.${i + 1}` : ''}`);
                // pytest exits 5 when it collected nothing: in a narrowed run that is "no test selected", judged below
                const exit = narrowedTier && config.stack === 'pytest' && !config.commands?.[tier] && ran.code === 5 ? 0 : ran.code;
                if (exit !== 0 && code === 0)
                    code = exit;
                summaryError ??= ran.error;
                if (ran.summary)
                    parts.push(ran.summary);
            }
            // a run that wrote no summary leaves the tier unmeasured
            const summary = parts.length === commands.length && parts.length > 0 ? mergeSummaries(parts) : undefined;
            finishTier(tier, code, summary, summaryError, seconds());
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
    // tiers that shared a run share its summary: count each summary once
    const summaries = [...new Set(results.map((r) => r.summary).filter((x) => x !== undefined))];
    const flaky = summaries.reduce((n, x) => n + x.flaky.length, 0);
    // Quarantined tests have their own count; `skipped` is every other skip (a quarantined one is skipped by its tag).
    const skipped = summaries.reduce((n, x) => n + Math.max(0, x.skipped - x.quarantined), 0);
    // Before the summary block, which stays last: Current keeps only the tail of a gate's output (2 KB) and reads the block
    // from the last `=== gate summary ===` in it, so many skips must not push the marker out.
    for (const line of skipLines(summaries))
        console.log(line);
    console.log('\n=== gate summary ===');
    for (const r of results) {
        const label = r.status === 'ok' ? 'OK' : r.status === 'failed' ? 'FAILED' : 'skipped';
        console.log(`  ${r.name.padEnd(10)} ${label.padEnd(8)} ${String(r.seconds).padStart(4)}s  ${r.detail}`);
    }
    for (const line of protectedLines(results))
        console.log(`  ${line}`);
    for (const x of summaries)
        for (const label of x.flaky)
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
                : `GATE GREEN (quarantined: ${quarantined}, flaky: ${flaky}, skipped: ${skipped})`
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
