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

## What this trait does not cover

A trap not listed here follows the base standard's framework-traps rule: look for the pattern in the surrounding
code before improvising. This file is a list of the traps that have already bitten, not an exhaustive framework
guide.
