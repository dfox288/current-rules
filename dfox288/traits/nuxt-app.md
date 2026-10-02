# Trait: `nuxt-app`

Your repo is a Nuxt app or layer. These are the framework traps that have already bitten, as checkable
statements.

## Rules

- **[rule]** NuxtUI's theme cascade: check the documented pattern for how a component's theme tokens flow before
  overriding one by hand. *Check: reviewer reads a theme override for whether it fights the cascade instead of
  working with it.*
- **[rule]** Colour-mode-dependent rendering goes through `<ClientOnly>` (or the repo's established equivalent) —
  not a raw `useColorMode()` read during SSR. *Check: reviewer reads new colour-mode-conditional markup for
  hydration-mismatch risk.*
- **[rule]** Tailwind v4 tokens are used as documented (the design tokens, not ad hoc utility stacking that
  fights them). *Check: reviewer reads new class lists against the token set.*
- **[rule]** Pinia stores use the composition syntax the codebase already uses, not the options-style API mixed
  into a composition-style store. *Check: reviewer reads new/changed store code for consistency with the
  surrounding file.*
- **[rule]** Only a build compiles templates: typecheck and unit tests don't. A change to a template, config or
  routes needs the repo's build (or the check that covers it) before you call it done. *Check: reviewer reads the
  report for the build on a template or config change.*

## Tests

The testing rules are in `testing.md` and `bindings/nuxt-ts.md` at the top of this repo.

- **[rule]** Pick the checks by the change. Tests, docs, comments or CSS values only: the focused test. Logic in one
  module or component: plus `typecheck`. A template, `nuxt.config`, a new auto-import, a route, middleware, auth or env
  handling: plus `typecheck` and `build`, and `test:e2e` for a route, middleware, auth or env change. The focused test is
  `pnpm test <file>`, never `pnpm test -- <file>` (the script swallows the `--`); read the `Test Files` count. A break-it
  runs its one test. *Check: reviewer reads the report's checks against the diff's kind.*

## What this trait does not cover

A trap not listed here follows the base standard's framework-traps rule: look for the pattern in the surrounding
code before improvising. This file is a list of the traps that have already bitten, not an exhaustive framework
guide.
