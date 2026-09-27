# Trait: `released`

Your repo ships on version tags that someone else consumes or deploys from. Day to day the changelog keeps a
running `## Unreleased` section; this trait adds what happens at release time.

## Rules

- **[contract item]** At release, the `## Unreleased` section is renamed to a dated version heading (Keep a
  Changelog style), and a fresh empty `## Unreleased` is added above it. *Check: reviewer/release step confirms
  the previous Unreleased section is gone and a dated one with the new version exists.*
- **[contract item]** The version bump matches what's actually in the cut (a breaking change bumps differently
  than a fix) — decided at release time, not guessed by a worker mid-job. *Check: whoever cuts the release
  compares the dated section's entries against the bump; not a per-job worker responsibility.*
- **[rule]** Release notes for anyone outside the repo are written from the merged PRs in the cut, not
  re-authored from memory. *Check: reviewer of the release step (not the per-job worker/reviewer) cross-checks
  notes against the PR list.*

## What this trait does not cover

Day-to-day PR entries under `## Unreleased` — that's the base standard's changelog rule, same for every repo
regardless of trait.
