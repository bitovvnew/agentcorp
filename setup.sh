#!/usr/bin/env sh
set -eu

repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
cd "$repo_dir"
npm ci --no-audit --no-fund
exec node bin/agentcorp.js setup --web "$@"
