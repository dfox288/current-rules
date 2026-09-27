# Trait: `unreleased`

Your repo is never cut into a dated release. The base standard's changelog rule still applies; this trait says
what happens to the entry after that.

## Rules

- **[rule]** The `## Unreleased` section is never cut, never dated, never version-bumped — it is the whole
  history, permanently. *Check: reviewer flags a PR that adds a dated section or a version heading to a repo with
  this trait; that belongs in `released.md` instead.*
- **[rule]** The merged PR, plus the reviewer's verdict on it, is the record of what happened — there is no
  separate release-notes document to keep in sync. *Check: not itself checkable per job; this is what makes the
  changelog-touch rule sufficient on its own for this trait, instead of needing a release step too.*

## What this trait does not cover

Whether the repo *should* stay unreleased — that's a standing decision (Reza's), not something a worker
re-litigates per job.
