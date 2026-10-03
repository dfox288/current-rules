# Presets changelog

## Unreleased

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
