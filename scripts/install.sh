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

# custom-permissions is the only plugin in plugins/custom-permissions/.
# Other files in that directory are libraries (tighteners.ts) or the rule
# snapshot (builtin-rules.json) and are imported via the plugin's symlink.
ln -sf "${repo_root}/plugins/custom-permissions/custom-permissions.ts" \
	"${plugins_dir}/custom-permissions.ts"

if command -v amp >/dev/null 2>&1; then
	amp skills add "${repo_root}"/skills/*
else
	printf 'amp not found on PATH; skipped skill registration.\n' >&2
fi

printf 'Installed Amp settings, plugins, and skills from %s\n' "${repo_root}"
