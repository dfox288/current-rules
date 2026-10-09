import type { Plugin } from 'vitest/config';
/**
 * A test file that is only `import '@dfox288/test-preset-vitest/checks-map-test'`, as source an `it` that Vitest's static
 * scan can see: `vitest list` reads the file's own code and a test behind an import is not there ("No test suite found").
 * Anything else comes back undefined.
 */
export declare function expandShapeTestImport(code: string): string | undefined;
/**
 * Adds the preset's reporter once the run's own reporters exist. Every project lists it (Vitest calls
 * `configureVitest` only for the plugins of the projects, not the root's); the first call registers it.
 */
export declare function testPresetPlugin(): Plugin;
