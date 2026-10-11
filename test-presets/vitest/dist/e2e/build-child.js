// The child process of `buildOnce` (see `./index.ts`): loads the global setup module that called it through Vite's SSR
// loader (TypeScript, extensionless imports, no repo Vite config) and runs its default export, which, with the child
// marker set, runs the build function itself. Exit code 0 when the build resolved, 1 when it threw (the error is on stderr).
import { createViteServer } from 'vitest/node';
const file = process.argv[2];
if (!file) {
    process.stderr.write('build-child: no setup module given\n');
    process.exit(2);
}
const server = await createViteServer({
    configFile: false,
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
});
let code = 0;
try {
    const setup = (await server.ssrLoadModule(file)).default;
    if (typeof setup !== 'function')
        throw new Error(`${file} has no default export that is a function (export default buildOnce(...))`);
    await setup();
}
catch (error) {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    code = 1;
}
finally {
    await server.close().catch(() => { });
}
process.exit(code);
