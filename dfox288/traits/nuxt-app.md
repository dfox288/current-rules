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
- **[rule]** Vitest's default reporter hides the console output of passing tests: a count of warnings (deprecations,
  runtime warnings) needs `--reporter=verbose` and a control that puts one known-bad use back. A test that renders no
  component can't see a runtime warning at all: report that count as "not measured". In `@nuxt/test-utils`,
  `captureServerLogs` swallows server warnings; turn it off for a count. *Check: reviewer reads a warning count for
  its reporter and its control.*
- **[rule]** Run tests through the package script (`pnpm test <file>`), not a bare `vitest run`: the script can set
  the environment the tests need. `--exclude` is ignored when the config uses `projects`, and `--project <name>` with
  a name Vitest never assigned selects nothing: pass files by name and read the `Test Files` count. *Check: reviewer
  reads the focused run's count against the files named.*
- **[rule]** Only a build compiles templates: typecheck and unit tests don't. A change to a template, config or
  routes needs the repo's build (or the check that covers it) before you call it done. *Check: reviewer reads the
  report for the build on a template or config change.*

## What this trait does not cover

A trap not listed here follows the base standard's framework-traps rule: look for the pattern in the surrounding
code before improvising. This file is a list of the traps that have already bitten, not an exhaustive framework
guide.
