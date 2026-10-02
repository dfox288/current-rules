// The numbers of the testing baseline (`bindings/nuxt-ts.md`, "The preset sets"). One place, so the
// limits are the same in the config, the reporter and the tests that prove them.

/** Per-test time limit in milliseconds, by tier. Hard: a test over its limit fails. */
export const LIMITS = { small: 5_000, medium: 15_000, large: 30_000 } as const

/** The tags a test may carry. Vitest rejects any other (`strictTags`). */
export const TAGS = [
  {
    name: 'medium',
    description: 'touches a database, files or an in-process server (tier medium, 15 s)',
    timeout: LIMITS.medium,
  },
  {
    name: 'protected',
    description:
      'changed or deleted only with an explicit go: a safety guard or the test for a real incident',
  },
  {
    name: 'quarantine',
    description:
      'flaky, out of the suite that blocks a merge: skipped and counted until fixed or deleted',
    skip: true,
  },
]

/** Project names are Nuxt's folder names (`test/unit`, `test/nuxt`, `test/e2e`). */
export const PROJECTS = { unit: 'unit', nuxt: 'nuxt', e2e: 'e2e' } as const

/** Where the reporter writes the run summary when the gate script asks for it. */
export const SUMMARY_ENV = 'TEST_PRESET_SUMMARY'
export const DATABASE_ENV = 'TEST_DATABASE_URL'
