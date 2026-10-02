# current-rules

> **What this is:** the working rules for our own coding agents (run by Current) in our own repos, and the test
> presets those repos install. Public so our repos can install the presets without a token. Not a product, not
> maintained for outside use, no support; feel free to read or borrow.

The rules Current's agents work by, for the realms owned by dfox288: one folder per realm, each holding
`standard.md` (the realm standard) and `traits/<name>.md` (one file per trait a repo can list).

Changes go through a pull request that Reza approves; nobody edits rules directly (Surveyor decision, 2026-09-28).
A trait used by one repo or many is the same file; each repo's `traits` list says who uses it. Rules for a single
repo that will never be shared belong in that repo's own `CLAUDE.md`. Other owners keep their rules in their own repo.
