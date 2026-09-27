# The rules standard

You are a worker (or reviewer) running in a container with only this repo's own clone. There are no sibling
checkouts and no shared filesystem. This file plus your repo's declared traits (they follow
this file in your job) is everything that binds you; your repo's own `CLAUDE.md` adds only what it deliberately does
differently.

**The boundary:** anything not covered here, in your traits, or in your repo's `CLAUDE.md` is reported, not
decided. Say what you found and stop; don't guess at intent.

Each rule below is tagged **[contract item]** (mechanical, the reviewer or a gate checks it every job) or
**[rule]** (discipline, checked by the reviewer reading your diff and report, not by a script). A rule that can
only be judged true in aggregate across many jobs is a goal, not here — you are not responsible for it.

## Gates

- **[contract item]** Run the finishing gate command whole, never piped (`| tail`, `| grep` on a gate hides its
  exit code). *Check: the reviewer requires the worker's report to quote the gate's own summary line and exit
  code, not a filtered excerpt.*
- **[rule]** Size the checks you run to the change you made — don't run the full suite for a one-line fix, don't
  skip the suite for a wide one. *Check: reviewer judges proportionality against the diff.*

## Measurement

- **[contract item]** A zero, a "not found", or a green check is evidence only after the same command has been
  seen to return something else — a positive control. *Check: reviewer requires the report to show the control
  (a planted match, a deliberately broken case) alongside the zero.*
- **[rule]** The same bar applies to "still open" as to "closed" — don't declare either without having watched
  the check fail once. *Check: reviewer reads for this reasoning in the report, not just the conclusion.*

## Commits and issues

- **[contract item]** No AI provenance markers in commit messages or PR text. *Check: reviewer greps the commit
  log and PR body.*
- **[contract item]** No secrets, tokens, or personal data in a commit, PR body, or issue. *Check: reviewer scans
  the diff and PR text; a gate secret-scanner if the repo has one.*
- **[rule]** Commits are atomic and conventional (one logical change each, a normal `type: subject` message).
  *Check: reviewer reads the commit list.*
- **[rule]** Rebase before pushing; don't merge main in. *Check: reviewer/gate reads the branch's merge-base.*
- **[rule]** Anything you deliberately deferred gets its own issue, named in the PR — not a TODO comment with no
  tracker entry. *Check: reviewer greps the diff for deferral language ("later", "TODO", "follow-up") and
  confirms a linked issue exists for each.*

## Docs and changelog

- **[contract item]** A commit that fixes, adds, or improves something touches `CHANGELOG.md` in the same push,
  unless the commit message carries `Changelog: none (<why>)`. *Check: a pre-push hook (or the reviewer, reading
  the commit range).* What you write in the changelog (a running
  "Unreleased" entry vs. a dated cut section) depends on your `released`/`unreleased` trait — see those files.
- **[rule]** `README.md` only names commands and paths that exist in the tree. *Check: reviewer spot-checks
  backticked paths/commands against the repo; a drift gate if the repo has one.*
- **[rule]** `docs/features.md` (if the repo has one) lists only what exists on `main`, one line per feature,
  each cited to where it lives — no "planned"/"coming"/"partial" markers. *Check: reviewer reads the file against
  the diff for anything newly true that isn't listed, or anything listed that isn't true yet.*

## Destructive actions

- **[rule]** Archive, don't delete, when removing something that isn't obviously disposable; record what you
  removed and why before removing it. *Check: reviewer reads the diff for a bare deletion with no note.*
- **[rule]** Count before and after a bulk change (a migration, a mass rename, a mass delete). *Check: reviewer
  requires both counts in the report.*
- **[contract item]** Never run as root inside your own container. *Check: gate/harness enforces the container's
  user; reviewer flags a `Dockerfile`/script change that removes the non-root user.*

## Framework and stack traps

- **[rule]** Before improvising around a framework quirk, check whether one of your traits already
  documents it. If it isn't documented, follow the
  surrounding code's own pattern rather than inventing a new one. *Check: reviewer compares your approach against
  the trait file and the surrounding code.*

## Hosts and ports (only if your job starts a dev server)

- **[rule]** Check the port is free before binding it; confirm a process is yours before killing it; stop
  whatever you started before finishing. *Check: reviewer reads the job log for a start without a matching stop,
  or a kill with no ownership check.*

## Traits

Your repo declares the traits that apply to it; each trait's rules apply in addition to this file.
