# The testing baseline: how the system runs it

The part of the testing baseline that is for the Surveyor and Current's design, not for a worker writing tests:
which checks run where and when, the coverage and mutation policy, and how repos stay on the baseline. Not part of any
worker's prompt. The rules a worker writes tests by are in `testing.md`; each stack's binding is in `bindings/`; the
selection file's format is in `selection.md`.

## When checks run

| Stage | Where | What runs | Whole or narrowed | Whole when |
|---|---|---|---|---|
| Worker iterating | Current's worker | The tests of the files it changed: changed test files, and where the kind narrows, the toolchain's selection (`selection.md`) | Narrowed | Never: a whole kind is the gate's |
| Before the commit | The commit hook | Format and lint on the staged files, typecheck incremental. No tests | Staged files; typecheck whole but incremental | Not applicable |
| Worker done: the gate | Current, once, on the committed tip | The selection from the base's `checks.map.yml` and `base..tip` (`selection.md`); the `always` kinds | Per kind, by the reading rules | A trigger, a file nothing matches, a change to the selection file, a kind without `narrow`, the `always` kinds (lint, format, typecheck) |
| Before merge | CI on the PR | Nothing new on the gated tree. What the gate did not cover (a person's PR, a kind Current does not run): the same selection | As at the gate | As at the gate |
| After merge | CI on Actions, every merge commit on main | Every kind, all tiers the gate covers | Whole | Always |
| Nightly | CI | All three tiers | Whole | Only if main's head or the test environment (worker image, runtime and package manager versions, tool versions; not lockfile dependencies) changed since the last green full run. No run on the clock alone |
| Tag or release | CI | A smoke test of the built artifact, plus proof that this commit passed the gate | No full re-run | Never |

- **[rule]** The selection is deterministic: a pure function of the selection file on the base and the changed files.
  Kinds are chosen by path; a changed test file always runs; otherwise a kind runs whole, and a kind that is slow is
  made fast rather than selected. Narrowing inside a kind by the toolchain's own import graph is a per-toolchain step
  on top, never the base. No coverage database, no stored state.
- **[rule]** The commit hook is one shared hook per toolchain, from the presets. In Current's worker it runs after
  Current's own hooks (stop, secrets, markers, trailers), which stay first. The worker does not request format, lint
  or typecheck as checks; the gate runs them whole, reused on an unchanged tree. Tests never run in the hook.
- **[contract item]** After every merge, the merge commit on main gets one full run: never cancelled by a later push,
  never skipped because the PR's run passed the same tree. A red required check reverts the merge and reopens the item
  (the breaker). *(Not built yet; until then the nightly full run is the only full run.)*
- **[contract item]** The full run after the merge is the check of the selection. A gate that ran a kind narrowed or
  skipped it, green, followed by a red full run in that kind, is a miss: counted per repo, with the failing test and
  the file that caused it. The fix is in the selection file (a trigger or an edge) or the test,
  filed with the revert. *(Not built yet.)*
- **[rule]** Every CI job runs on `${{ vars.RUNNER_NUC || 'ubuntu-latest' }}`. GitHub-hosted runners are only the
  fallback: with only the variable unset, every workflow still runs and stays green on them.
- **[rule]** No merge queue now. Later only on our own runners or tooling.
- **[rule]** Current may change and merge the selection file like any other file: it is read from the base, and a
  change to it runs everything. `.github/` and the files that decide whether a test counts (the gate config, the gate
  script, the test runners' configs, the root `conftest.py`) stay fenced.

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
