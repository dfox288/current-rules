# The testing baseline: how the system runs it

The part of the testing baseline that is for the Surveyor and Current's design, not for a worker writing tests:
when each tier runs, the coverage and mutation policy, and how repos stay on the baseline. Not part of any worker's
prompt. The rules a worker writes tests by are in `testing.md`; each stack's binding is in `bindings/`.

## When each tier runs

- Per change: small and medium, affected files only.
- Before merge: small and medium in full; large for affected paths only.
- Nightly: all three tiers in full, only if main's head or the test environment (worker image, runtime and package
  manager versions, tool versions; not lockfile dependencies) changed since the last green full run. No run on the
  clock alone.
- Tag or release: a smoke test of the built artifact, plus proof that this commit passed the gate. No full re-run.

Which system runs each line (Current or CI) is set by the check strategy, not here.

## Coverage and mutation testing

- **[rule]** Coverage is reported on request, never gated.
- Mutation testing is a trial in the pilot repo only (changed files, before merge, score and surviving mutants to the
  reviewer, no gate). Whether it becomes a gate is decided after the trial.

## How repos stay on it

- Each stack has one preset and all stacks share one gate script with one set of gate names. Both live in one public
  GitHub repo; a repo installs them as a git dependency pinned to a tag (pnpm, uv) and adds only its project list and
  its justified differences. No registry. A new preset version reaches a repo as a repin (the tag bumped).
- **[contract item]** The conformance script checks each repo against this file, its binding and the repo's declared
  traits. Each item prints red, green or NOT MEASURED; a check that could not run is never green. It runs in the gate
  before merge and on a schedule over all repos. *(Not enforced yet: horizon-surveyor#70; until then the reviewer checks it.)*
- A new repo is set up by the conformance script's `init` mode for its stack, and its check is green before the first
  worker job.
