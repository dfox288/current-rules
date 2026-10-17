## Tests

This repo has no tests yet. Its checks are `lint` and `typecheck` (`pnpm gates`, or `pnpm gates --only=lint`).

Tests are added by the first change that writes them, in one pull request that:

- follows the testing baseline of `dfox288/current-rules` (`testing.md`, `bindings/nuxt-ts.md`): Nuxt's folders
  `test/unit`, `test/nuxt` and `test/e2e` as Vitest projects, with `pnpm test` as the one script;
- installs `@dfox288/test-preset-vitest` (the same version as `@dfox288/test-gates`) and writes `vitest.config.ts` with
  `defineTestConfig`;
- adds `test-floors.json`, the tiers in `gates.config.json`, and a `test` kind to `scripts/gates.mjs`,
  `checks.kinds.yml` and `checks.map.yml` (with its paths and test globs, version 2).
