# Trait: `python-collector`

Your repo has a Python component beside its main code.

## Rules

- **[contract item]** The collector's own test command runs and passes as part of the finishing gate, not as an
  optional extra. *Check: the configured gates include it; the reviewer confirms the report quotes its result separately from the Nuxt tests.*
- **[rule]** Collector code stays stdlib-only unless a real need justifies a new dependency — the container image
  only has what `tools.apt` names. *Check: reviewer flags a new Python import with no matching image change.*
- **[rule]** No real transcript, log, or credential fixture in test data — invented data only. *Check: reviewer
  reads new/changed fixtures for anything that looks like a real captured payload.*

- **[rule]** A protected test (see the base standard) carries a `# protected: <reason>` comment on its test class; the
  count is a grep with a control that fires. A second-language suite mirrors the JS tiers: tests that need Docker or a
  server are named apart from those that don't, and the README names modules that break the pattern. *Check: reviewer
  reads new test classes for the comment on a guard.*

## What this trait does not cover

Anything about the TypeScript/Nuxt side of the same repo — that's the base standard plus whatever other traits
apply.
