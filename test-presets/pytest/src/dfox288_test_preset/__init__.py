"""The pytest preset of the testing baseline (bindings/python.md).

The plugin loads on its own once the package is installed (entry point `pytest11`). Repos use
`dfox288_test_preset.db` for a schema per test or file, and `dfox288_test_preset.net` for a free port.
"""

LIMITS = {"small": 5, "medium": 15, "large": 30}
# `-n auto` under the preset: one worker per core, at least 4 and at most 6 (README, "Parallel runs").
WORKERS = (4, 6)
