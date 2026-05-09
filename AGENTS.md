# Agent Instructions

No repository-specific issue tracker is configured for this project.

## Permissions

A single plugin handles all permission decisions:
[plugins/custom-permissions/custom-permissions.ts](plugins/custom-permissions/custom-permissions.ts).
It is loaded in addition to Amp's legacy permissions plugin, which is
silenced via `amp.dangerouslyAllowAll: true` in
[settings.json](settings.json).

When updating permissions, choose the right surface:

- **Simple glob/regex allow/ask/reject rules** → add to `amp.permissions`
  in [settings.json](settings.json). The plugin reads this list as the user
  rule layer in its cascade and falls back to a snapshot of Amp's built-in
  rules in
  [plugins/custom-permissions/builtin-rules.json](plugins/custom-permissions/builtin-rules.json).
  Add a case to
  [scripts/test-custom-permissions.ts](scripts/test-custom-permissions.ts)
  and run `bun run scripts/test-custom-permissions.ts`.
- **Heuristic / conditional logic** that can't be expressed as a glob (e.g.
  "allow this script unless `--write` is present", "ask before any
  Python `-c`") → add to the relevant `evaluate*` helper in
  [plugins/custom-permissions/tighteners.ts](plugins/custom-permissions/tighteners.ts).
  Tighteners run after the rule cascade and can convert an `allow` decision
  into a confirm prompt; they cannot loosen an `ask` into an `allow`. Add a
  case to
  [scripts/test-permissions-plugin.ts](scripts/test-permissions-plugin.ts)
  and run `bun run scripts/test-permissions-plugin.ts`.
- **Refreshing the built-in snapshot** (after upgrading Amp) → run
  [scripts/refresh-builtin-permissions.sh](scripts/refresh-builtin-permissions.sh)
  and re-run both test scripts.
