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
- **[rule]** A red check is a finding until proven otherwise: report it with its output, don't explain it away.
  *Check: reviewer reads the report for a red check called flaky, unrelated or environmental without evidence.*
- **[rule]** A focused run shows its focus: read the count of files or tests it ran, and it must be non-zero and match
  what you named. A filter that matches nothing, or is silently dropped (an argument the script swallows, an
  `--exclude` the runner ignores), still exits 0. *Check: reviewer requires the count in the report.*
- **[rule]** Run a check in the foreground and wait for it to return; never start it in the background and `sleep` a
  guessed time. The check returns when it is done, and every second slept after that is time the job waits for
  nothing. *Check: reviewer reads the transcript summary for a `sleep` while a check ran.*

## Measurement

- **[contract item]** A zero, a "not found", or a green check is evidence only after the same command has been
  seen to return something else — a positive control. *Check: reviewer requires the report to show the control
  (a planted match, a deliberately broken case) alongside the zero.*
- **[rule]** The same bar applies to "still open" as to "closed" — don't declare either without having watched
  the check fail once. *Check: reviewer reads for this reasoning in the report, not just the conclusion.*
- **[rule]** The control goes through the same command, and tests the axis of your claim: a planted match proves
  the pattern works, not that an unrelated classifier does. *Check: reviewer reads the control against the claim it
  backs.*
- **[rule]** A scan covers every place the thing can be read (templates, scripts, selector strings, CSS, tests,
  tooling config), and you read the hits before counting them (a pattern for hex colours also matches issue numbers).
  Read the whole file (`wc -l` first) before claiming something is missing from it. *Check: reviewer compares the
  scan's scope with the places the name can live.*
- **[rule]** Before you run a check, say what its failure would look like; if you can't, it cannot fail (two
  different failures that both return 404 prove nothing by status code). *Check: reviewer reads the report for what
  the check could have shown.*
- **[rule]** A break-it must reach the check it tests: if the build fails on the break before the check runs, it
  proved nothing. Undo it with an edit, never `git checkout -- <file>` over uncommitted work. *Check: reviewer reads
  the break-it's output.*
- **[rule]** Every count in your report names its control and whether it fired; a zero without one is reported as
  "not measured". *Check: reviewer reads each count for its control.*
- **[rule]** A red-first test is shown red: run it against the code before your change and quote the failure. The
  failure must be the behaviour the test is about, not a missing import, symbol or API the old code never had. If
  the test cannot go red there (the old code already behaves as asked, or the only failure is the missing symbol),
  the spec's premise is false: report that with the run, and don't present the test as red-first proof. *Check:
  reviewer reads the quoted red run against the behaviour; a red-first claim without one is unmet; a premise the
  worker showed false goes back to the spec, not to the worker as unmet.*

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
