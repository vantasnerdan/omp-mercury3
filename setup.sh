#!/bin/sh
set -eu

command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js 20+ is required.' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { printf '%s\n' 'npm is required.' >&2; exit 1; }
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"
npm ci --ignore-scripts --no-audit --no-fund
exec node "$SCRIPT_DIR/setup.mjs" "$@"
