# CLAUDE.md

A Nuxt app. This file is short on purpose; extend it as the project grows.

## Checks

- `pnpm gates` runs every check kind of `checks.kinds.yml` (today `lint` and `typecheck`); `pnpm gates --only=lint` runs one.
  Current runs a kind as `node scripts/gates.mjs --only=<kind>`.
- `checks.map.yml` says which kinds a change runs, `checks.kinds.yml` what each kind is. Both are fenced: a change to them
  is a change to how every check runs.
- There are no tests yet. The first change that writes tests adds the test kind, following current-rules `testing.md` and
  `bindings/nuxt-ts.md` (see "Tests" in README.md).

## Rules

- Node 24 or newer, pnpm. The `@dfox288` packages come from the private registry (`.npmrc`).
- `pnpm lint` and `pnpm typecheck` stay green before every commit.
