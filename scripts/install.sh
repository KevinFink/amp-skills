#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
amp_config_dir="${HOME}/.config/amp"
plugins_dir="${amp_config_dir}/plugins"

mkdir -p "${plugins_dir}"

ln -sf "${repo_root}/settings.json" "${amp_config_dir}/settings.json"

for plugin in "${repo_root}"/plugins/*.ts; do
	[ -e "${plugin}" ] || continue
	ln -sf "${plugin}" "${plugins_dir}/$(basename "${plugin}")"
done

# Amp's single-plugin loader rejects symlink entrypoints. Keep the entrypoint
# real while importing the canonical source and its policy from this repository.
permissions_entry="${plugins_dir}/custom-permissions.ts"
if [ -L "${permissions_entry}" ]; then
	rm "${permissions_entry}"
fi
python3 - "${repo_root}" > "${permissions_entry}" <<'PY'
import json
import sys
print('export { default, description } from ' + json.dumps(sys.argv[1] + '/plugins/custom-permissions/custom-permissions.ts'))
PY

if command -v amp >/dev/null 2>&1; then
	amp skills add "${repo_root}"/skills/*
else
	printf 'amp not found on PATH; skipped skill registration.\n' >&2
fi

printf 'Installed Amp settings, plugins, and skills from %s\n' "${repo_root}"
