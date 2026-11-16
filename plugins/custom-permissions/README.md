# custom-permissions

A machine-wide Amp authorization plugin. It owns its policy files and does not read Amp's deprecated `amp.permissions` or guarded-file settings. Approval dialogs require a human response.

## Policy

The existing decision order is preserved:

1. Context-sensitive Git staging, commit, and landing decisions, followed by the plugin's custom allowances.
2. User rules in [`user-rules.json`](user-rules.json), in order.
3. The baseline in [`builtin-rules.json`](builtin-rules.json), in order.
4. No matching rule: ask the user.
5. For allowed shell commands, [`tighteners.ts`](tighteners.ts) can require approval but cannot loosen a decision.

Patterns use `*` globs or JavaScript regexes wrapped in `/.../`. Shell command segments are evaluated separately. User rules are reloaded when the policy file changes. If the user policy is missing, malformed, or cannot be evaluated, the tool call is rejected rather than falling back to a weaker policy. Unavailable approval UI also rejects the call.

`user-rules.json` preserves the 33 user rules migrated from settings on November 16, 2026. The 107-rule baseline is the unchanged snapshot originally imported from Amp; it is now maintained here deliberately, not refreshed after CLI upgrades. The `builtin` decision-source label is retained for compatibility with existing tests and analysis output. The deprecated `amp permissions` commands are not required to install or maintain this plugin.

## Installation on this machine

From the repository root, install only this plugin:

```bash
mkdir -p ~/.config/amp/plugins
if [ -L ~/.config/amp/plugins/custom-permissions.ts ]; then
  unlink ~/.config/amp/plugins/custom-permissions.ts
fi
python3 - "$(pwd)" <<'PY' > ~/.config/amp/plugins/custom-permissions.ts
import json, sys
print('export { default, description } from ' + json.dumps(sys.argv[1] + '/plugins/custom-permissions/custom-permissions.ts'))
PY
```

The full `scripts/install.sh` also links settings and other plugins and registers skills. It replaces an old permissions symlink before creating a real entrypoint, because Amp's single-plugin loader rejects symlinks. When installing manually, remove that old symlink first rather than redirecting through it. Supporting files resolve relative to the imported canonical source and do not need separate links.

Ask Amp to load or reload `~/.config/amp/plugins/custom-permissions.ts` in an existing session. New sessions discover the system plugin automatically. Existing runners need a plugin reload or restart; creating the entrypoint alone does not update their loaded code. Check `amp plugins list` for successful loading, then exercise approval and rejection with harmless commands before relying on enforcement.

Do not put policy in `amp.permissions` or `amp.guardedFiles.allowlist`. Current Amp runs tools without confirmation by default; this plugin supplies the approval boundary. The installed CLI may retain `amp.dangerouslyAllowAll: true` to silence its legacy approval layer; that value is not the deprecated `false` mode and does not bypass this plugin. Do not switch it to `false` to restore permission enforcement—verify the plugin instead.

This installation is local to the machine. A personal/global plugin must have a valid root entrypoint, include its policy and supporting files, and be published separately. Do not publish the older `~/plugins` clone over this implementation without reconciling them. Keep one active permissions implementation per session to avoid duplicate prompts.

## Tests and changes

```bash
bun run scripts/test-custom-permissions.ts
bun run scripts/test-permissions-plugin.ts
```

If Bun is not installed, use `npx --yes bun run` in place of `bun run`. Add a public behavior case to the relevant existing test when changing policy. User-rule changes belong in `user-rules.json`; conditional checks belong in `tighteners.ts`.

## Thread title statuses

[`thread-title-status.ts`](thread-title-status.ts) manages priority-ordered status prefixes. `⚠️` marks an active permission prompt and takes precedence over `🙋`, which [`thread-wait-status.ts`](thread-wait-status.ts) applies when the assistant appears to need user action. Status handling does not authorize tool calls.

## Boundaries

- Amp permits tools by default if this plugin fails to load or is missing. Check runtime loading; a passing policy test is not proof of installation.
- The migrated rules are not a read-only sandbox. They preserve existing allowances for package commands, file editing, GitHub issue mutations, and other operations.
- No new sensitive-file policy was added during migration. Tool-level edit allowances do not reproduce Amp's former guarded-file checks, and shell access is another route to files.
