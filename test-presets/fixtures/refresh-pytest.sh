#!/usr/bin/env bash
# Dev loop: reinstall the pytest preset into the Python fixture after a change.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here/python-pkg"
uv sync --group test --reinstall-package dfox288-test-preset
