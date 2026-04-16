#!/bin/sh
set -eu

ELECTRON_BIN="$(node -e "process.stdout.write(require('electron'))")"

# pnpm/npm may export ELECTRON_RUN_AS_NODE=1 for CLI execution.
# Unset it completely (empty value is still treated as enabled by Electron).
exec env -u ELECTRON_RUN_AS_NODE NODE_OPTIONS="--import tsx" "$ELECTRON_BIN" .

