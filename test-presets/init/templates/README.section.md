## Tests and gates

This repo has no tests yet. Its checks are the kinds `lint` (`eslint .`) and `typecheck` (`nuxt typecheck`): `pnpm gates`
runs both, `pnpm gates --only=lint` one (`scripts/gates.mjs`, which runs the shared gate script `test-gates`, configured
in `gates.config.json`; each gate's output is in `.tmp/gates/<gate>.log`, and the run ends with `GATE GREEN` or
`GATE RED: <gate>`).

Tests are added by the first change that writes them, in one pull request that:

- follows the testing baseline of `dfox288/current-rules` (`testing.md`, `bindings/nuxt-ts.md`): Nuxt's folders
  `test/unit`, `test/nuxt` and `test/e2e` as Vitest projects, with `pnpm test` as the one script;
- installs `@dfox288/test-preset-vitest` (the same version as `@dfox288/test-gates`) and writes `vitest.config.ts` with
  `defineTestConfig`;
- adds `test-floors.json`, the tiers to the `tiers` list of `gates.config.json` (empty until then), and a `test` kind
  to `scripts/gates.mjs`, `checks.kinds.yml` and `checks.map.yml` (with its paths and test globs, version 2).
