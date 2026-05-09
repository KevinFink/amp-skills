#!/usr/bin/env bash
# Refresh the snapshot of Amp's built-in permission rules used by
# plugins/custom-permissions/custom-permissions.ts. Re-run this after
# upgrading Amp so the plugin keeps the same safe defaults.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${repo_root}/plugins/custom-permissions/builtin-rules.json"

amp permissions list --builtin --json > "${out}"
printf 'Wrote %s built-in rules to %s\n' \
	"$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "${out}")" \
	"${out}"
