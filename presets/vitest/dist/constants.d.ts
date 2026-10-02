/** Per-test time limit in milliseconds, by tier. Hard: a test over its limit fails. */
export declare const LIMITS: {
    readonly small: 5000;
    readonly medium: 15000;
    readonly large: 30000;
};
/** The tags a test may carry. Vitest rejects any other (`strictTags`). */
export declare const TAGS: ({
    name: string;
    description: string;
    timeout: 15000;
    skip?: undefined;
} | {
    name: string;
    description: string;
    timeout?: undefined;
    skip?: undefined;
} | {
    name: string;
    description: string;
    skip: boolean;
    timeout?: undefined;
})[];
/** Project names are Nuxt's folder names (`test/unit`, `test/nuxt`, `test/e2e`). */
export declare const PROJECTS: {
    readonly unit: "unit";
    readonly nuxt: "nuxt";
    readonly e2e: "e2e";
};
/** Where the reporter writes the run summary when the gate script asks for it. */
export declare const SUMMARY_ENV = "TEST_PRESET_SUMMARY";
export declare const DATABASE_ENV = "TEST_DATABASE_URL";
