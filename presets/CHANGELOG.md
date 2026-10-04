# Presets changelog

## Unreleased

- gate script, both stacks: a new gate `docs` (runs after `typecheck`, before the tiers). It compares the tree with its
  base (`--base=<ref>`, default `origin/main`; `docs.base` in `gates.config.json`) and is red when `README.md`,
  `docs/**/*.md` or `CLAUDE.md` still name, in backticks or as a link target, a path the diff removed or renamed, or a
  `package.json` / `pyproject` (`[project.scripts]`) script it removed or renamed. Each hit is
  `file:line: names <old>, which this change removed|renamed to <new>`. `--all` is the full scan: every backticked path
  in those files that is not in the tree (fenced blocks skipped). `docs.globs` adds doc files, `docs.ignore` keeps a
  name. With no base ref to compare (a fresh clone, no `origin/main`) the gate does a full scan; an explicit
  `--base` that does not resolve is red, not measured. A repo gets the gate by repinning `@dfox288/test-gates`; its
  first run may be red on lines that were already stale, which the repin commit fixes. The rule is in
  `dfox288/standard.md`, "Docs and changelog". (horizon-surveyor#149)

## 0.1.4 (2026-10-04)

- vitest preset: an untagged test in the `nuxt` project counts as medium, not small. A `nuxt` test boots Nuxt
  (`mountSuspended`), which `testing.md` calls medium ("an app or server booted in-process"). An untagged `unit` test is
  still small, and the `medium` tag still makes a `unit` test medium. The guards are unchanged: an untagged `nuxt` test
  still runs under the small guards (no network, writes only in the temp dir, no database), so one that needs those
  still carries the `medium` tag. `bindings/nuxt-ts.md` says the same.
  What an app does when it repins: its small floor drops by its `nuxt` test count and its medium floor rises by the
  same number, in the repin commit (the new count shows in the first gate run). The gate never raises a floor by hand.
  The gate script changes with it, so repin the preset and the gate script together: the small run covers the other
  projects (`--tags-filter '!medium'`), the medium run is two runs added into one summary (the other projects with
  `--tags-filter medium`, then the whole `nuxt` project), so what runs in a tier is what is counted in it.
  A repo whose `gates.config.json` sets its own `commands` must do the same split itself.
- both presets: the `protected` tag and marker descriptions follow the overseer-approval rule (the overseer approves
  changes; a removal or weakening needs an independent reviewer's check and is named in the item).
  (horizon-surveyor, testing.md tiers)

## 0.1.3 (2026-10-03)

- gate script, both presets: the gate summary reports the protected count per tier, one stable line per tier
  (`small: 437 tests, 41 protected`). The presets write `protected` per tier into the run summary (pytest: the
  `protected` mark on a test, its class or its module; Vitest: the `protected` tag, also inherited from a `describe`),
  so the count comes from the tier's own run. Reported only; floors are unchanged. A summary from an older preset
  prints `protected not reported`. A repo gets it by repinning both the preset and the gate script to the next tag.
  (horizon-surveyor#113)

## 0.1.2 (2026-10-03)

- vitest preset: the fetch guard resolves a relative URL against `globalThis.location` when there is one, then judges
  the host as before. A relative URL with no location stays refused; an absolute non-loopback URL is still refused in
  medium, and every fetch is still refused in small. (horizon-surveyor#81)
- pytest preset: the small tier's write guard judges the removal of a symlink (`os.remove`/`os.unlink`) by the link's
  own path, not by its target, so a test may remove a link it made inside its `tmp_path`. A write through a link to
  outside the allowed roots is still a violation. (horizon-surveyor#78)

## 0.1.1 (2026-10-03)

- pytest preset: the small tier's write guard allows importlib's atomic bytecode temp file
  (`__pycache__/<name>.pyc.<digits>`) as well as `__pycache__/<name>.pyc`, so a lazy stdlib import in a fresh
  interpreter no longer fails the test. No wider exemption: other names under `__pycache__` and a `.pyc.<digits>`
  name elsewhere are still violations. (horizon-surveyor#76)
