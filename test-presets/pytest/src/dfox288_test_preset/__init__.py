"""The pytest preset of the testing baseline (bindings/python.md).

The plugin loads on its own once the package is installed (entry point `pytest11`). Repos use
`dfox288_test_preset.db` for a schema per test or file.
"""

LIMITS = {"small": 5, "medium": 15, "large": 30}
