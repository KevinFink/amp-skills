# Agent Instructions

No repository-specific issue tracker is configured for this project.

## Permissions

- The canonical plugin is [plugins/custom-permissions/custom-permissions.ts](plugins/custom-permissions/custom-permissions.ts). Install its real system-plugin entrypoint with [scripts/install.sh](scripts/install.sh); Amp's single-plugin loader rejects symlink entrypoints.
- For glob/regex allow, ask, or reject rules, edit [user-rules.json](plugins/custom-permissions/user-rules.json), not Amp settings. Add a behavior case to [scripts/test-custom-permissions.ts](scripts/test-custom-permissions.ts) and run `bun run scripts/test-custom-permissions.ts`.
- For conditional shell checks, edit the relevant `evaluate*` helper in [tighteners.ts](plugins/custom-permissions/tighteners.ts). Tighteners may turn an allow into an approval prompt but cannot loosen an ask. Add a case to [scripts/test-permissions-plugin.ts](scripts/test-permissions-plugin.ts) and run `bun run scripts/test-permissions-plugin.ts`.
- The fallback [builtin-rules.json](plugins/custom-permissions/builtin-rules.json) preserves the former Amp defaults. Edit it deliberately and run both test scripts; do not refresh it from the deprecated `amp permissions` commands.
- Keep approval dialogs human-only (`requireHuman: true`). Verify runtime loading after installation: Amp permits tools by default if the plugin is missing. Existing runners need a plugin reload or restart.
