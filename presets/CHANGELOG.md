# Presets changelog

## 0.1.4 (2026-10-04)

- vitest preset: an untagged test in the `nuxt` project counts as medium, not small. A `nuxt` test boots Nuxt
  (`mountSuspended`), which `testing.md` calls medium ("an app or server booted in-process"). An untagged `unit` test is
  still small, and the `medium` tag still makes a `unit` test medium. The guards are unchanged: an untagged `nuxt` test
  still runs under the small guards (no network, writes only in the temp dir, no database), so one that needs those
  still carries the `medium` tag. `bindings/nuxt-ts.md` says the same.
  What an app does when it repins: its small floor drops by its `nuxt` test count and its medium floor rises by the
  same number, in the repin commit (the new count shows in the first gate run). The gate never raises a floor by hand.
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
