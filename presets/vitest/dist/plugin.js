import { testPresetReporter } from './reporter.js';
const registered = new WeakSet();
/**
 * Adds the preset's reporter once the run's own reporters exist. Every project lists it (Vitest calls
 * `configureVitest` only for the plugins of the projects, not the root's); the first call registers it.
 */
export function testPresetPlugin() {
    return {
        name: 'test-preset',
        configureVitest({ vitest }) {
            // The CLI's `--reporter` replaces the config's reporters, so a config-level reporter would
            // vanish exactly when a worker asks for a different output. `onAfterSetServer` and `reporters`
            // are not in Vitest 4.1's typed API; the break-it for the count guard proves they still work.
            if (registered.has(vitest))
                return;
            registered.add(vitest);
            const run = vitest;
            run.onAfterSetServer(() => {
                run.reporters.push(testPresetReporter);
            });
        },
    };
}
