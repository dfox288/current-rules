import type { ViteUserConfig } from 'vitest/config';
/** What a repo says about one project. Everything the baseline fixes is refused (see RESERVED). */
export interface ProjectInput {
    include: string[];
    exclude?: string[];
    /** Vite plugins of this project (`vue()`), aliases and defines: a project does not inherit the root's. */
    plugins?: unknown[];
    resolve?: Record<string, unknown>;
    define?: Record<string, unknown>;
    /**
     * A justified difference from the baseline, passed to Vitest as `test` options of this project. Needs
     * `justification`, a sentence the reviewer reads (the repo's trait records it as well).
     */
    test?: Record<string, unknown>;
    justification?: string;
}
export interface E2eInput extends ProjectInput {
    /** The limit for setup hooks, which covers the one-time build. The pilot measures it. */
    hookTimeout: number;
    /** The repo's build-once setup file(s), usually `export default buildOnce(...)` from `/e2e`. */
    globalSetup?: string[];
}
export interface PresetOptions {
    unit?: ProjectInput;
    /** Needs `@nuxt/test-utils`. Pass `false` or leave out for a repo without Nuxt's runtime. */
    nuxt?: ProjectInput;
    e2e?: E2eInput;
    /** Opt-in coverage (`test:coverage`), reported, never gated. */
    coverage?: Record<string, unknown>;
}
export declare function defineTestConfig(options: PresetOptions): Promise<ViteUserConfig>;
