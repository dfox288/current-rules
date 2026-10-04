// The one gate script of the testing baseline. Gate names are the same for every stack:
//   lint, format, typecheck, small, medium, large, build
// lint and format run first and stop the run when red; the others run on and the summary names every red
// gate. A gate is never piped: each command is spawned directly and its exit code is the gate's result.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
export const GATE_NAMES = ['lint', 'format', 'typecheck', 'small', 'medium', 'large', 'build'];
const TIERS = ['small', 'medium', 'large'];
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
 * The argv of each run that makes up a tier. Stack-specific, one place. A Vitest tag filter cannot say "everything in
 * the nuxt project, plus the medium-tagged tests of the others", so the nuxt project (every test there boots Nuxt, so
 * the preset counts it medium) runs on its own in the medium tier, and the small tier leaves it out. Run and count
 * then agree. A `commands` override and the pytest stack are one run.
 */
export function tierCommands(config, tier) {
    const own = config.commands?.[tier];
    if (own)
        return [own];
    if (config.stack === 'vitest') {
        const base = ['pnpm', 'exec', 'vitest', 'run'];
        const projects = (names) => names.flatMap((p) => ['--project', p]);
        if (tier === 'large')
            return [[...base, ...projects(config.projects?.large ?? ['e2e'])]];
        const smallMedium = config.projects?.smallMedium ?? ['unit', 'nuxt'];
        const nuxt = smallMedium.filter((p) => p === 'nuxt');
        const others = smallMedium.filter((p) => p !== 'nuxt');
        const runs = [];
        if (others.length > 0)
            runs.push([
                ...base,
                ...projects(others),
                '--tags-filter',
                tier === 'small' ? '!medium' : 'medium',
                ...(nuxt.length > 0 ? ['--passWithNoTests'] : []),
            ]);
        if (tier === 'medium' && nuxt.length > 0)
            runs.push([...base, ...projects(nuxt)]);
        return runs;
    }
    const marker = tier === 'small' ? 'not medium and not large' : tier === 'medium' ? 'medium' : 'large';
    return [['uv', 'run', '--group', 'test', 'pytest', '-m', marker]];
}
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
    };
}
/** Judges a finished tier run against the count guard. Returns a failure text, or undefined if it holds. */
export function judgeTier(tier, exitCode, summary, floors) {
    if (exitCode !== 0)
        return { failure: `exit ${exitCode}`, detail: '' };
    if (!summary)
        return {
            failure: 'no run summary written: the preset did not run, so the count guard is NOT MEASURED',
            detail: '',
        };
    const t = summary.tiers[tier];
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
    const results = [];
    let stop = false;
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
            const commands = tierCommands(config, tier);
            let code = commands.length === 0 ? 1 : 0;
            const parts = [];
            for (const [i, argv] of commands.entries()) {
                const suffix = commands.length > 1 ? `.${i + 1}` : '';
                const summaryPath = join(root, '.tmp', 'gates', `${name}${suffix}.summary.json`);
                rmSync(summaryPath, { force: true });
                const c = await runCommand(argv, root, join(root, '.tmp', 'gates', `${name}${suffix}.log`), {
                    ...process.env,
                    TEST_PRESET_SUMMARY: summaryPath,
                });
                if (c !== 0 && code === 0)
                    code = c;
                if (existsSync(summaryPath))
                    parts.push(JSON.parse(readFileSync(summaryPath, 'utf8')));
            }
            // a run that wrote no summary leaves the tier unmeasured
            const summary = parts.length === commands.length && parts.length > 0 ? mergeSummaries(parts) : undefined;
            const judged = judgeTier(tier, code, summary, floors);
            results.push({
                name,
                status: judged.failure ? 'failed' : 'ok',
                seconds: seconds(),
                detail: judged.failure ?? judged.detail,
                summary,
            });
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
    const ranNothing = results.every((r) => r.status === 'skipped');
    if (options.raiseFloors && red.length === 0 && !ranNothing)
        raiseFloors(root, config, floors, results);
    const verdict = ranNothing
        ? 'GATE RED: no gate ran'
        : red.length === 0
            ? `GATE GREEN (quarantined: ${quarantined}, flaky: ${flaky})`
            : `GATE RED: ${red.map((r) => (r.detail ? `${r.name} (${r.detail})` : r.name)).join(', ')}`;
    console.log(verdict);
    return { results, red: red.length > 0 || ranNothing, verdict };
}
/** Raises a tier's floor to the count of a green run. Never lowers one: a lower floor is a decision. */
export function raiseFloors(root, config, floors, results) {
    const next = { ...floors };
    let changed = false;
    for (const r of results) {
        if (r.status !== 'ok' || !r.summary || !TIERS.includes(r.name))
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
