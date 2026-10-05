import type { Plugin } from 'vitest/config';
/**
 * Adds the preset's reporter once the run's own reporters exist. Every project lists it (Vitest calls
 * `configureVitest` only for the plugins of the projects, not the root's); the first call registers it.
 */
export declare function testPresetPlugin(): Plugin;
