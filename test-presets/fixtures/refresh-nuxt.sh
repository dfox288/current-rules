#!/usr/bin/env bash
# Dev loop: rebuild the Vitest preset and reinstall it into the fixture (`file:` dependencies are
# copied by pnpm, not linked, so the preset's peers resolve from the fixture's own node_modules).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pnpm -C "$here/../vitest" build
pnpm -C "$here/nuxt-app" install --offline
