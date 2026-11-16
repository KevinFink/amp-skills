# amp-skills

Custom [Amp](https://ampcode.com) skills and settings.

## Setup

Run the installer to link settings and top-level plugins, install the permissions entrypoint, and register skills:

```bash
./scripts/install.sh
```

Or perform the steps manually. Symlink the settings file so Amp reads it:

```bash
ln -sf "$(pwd)/settings.json" ~/.config/amp/settings.json
```

Symlink tracked top-level plugins and create a real permissions entrypoint (Amp's single-plugin loader rejects symlinks):

```bash
mkdir -p ~/.config/amp/plugins
ln -sf "$(pwd)"/plugins/*.ts ~/.config/amp/plugins/
if [ -L ~/.config/amp/plugins/custom-permissions.ts ]; then
  unlink ~/.config/amp/plugins/custom-permissions.ts
fi
python3 - "$(pwd)" <<'PY' > ~/.config/amp/plugins/custom-permissions.ts
import json, sys
print('export { default, description } from ' + json.dumps(sys.argv[1] + '/plugins/custom-permissions/custom-permissions.ts'))
PY
```

Register the skills directory so Amp can discover skills. `amp skill` is the canonical command name in current Amp versions; `amp skills` may still work as a compatibility alias.

```bash
amp skill add ./skills/*
```

## Contents

### settings.json

Baseline Amp configuration: skills path, cache directory, update mode, and disabled tools. Permission policy belongs to the custom plugin, not Amp's deprecated settings. See the [Amp permissions docs](https://ampcode.com/docs/tools#permissions).

For permission changes:

- Add simple allow/ask/reject glob or regex rules to `plugins/custom-permissions/user-rules.json`, then add a case to `scripts/test-custom-permissions.ts`.
- Add heuristic or conditional safety checks that cannot be expressed as a glob to `plugins/custom-permissions/tighteners.ts`, then add a case to `scripts/test-permissions-plugin.ts`.
- Run both test scripts after changing the authorization system.

### plugins/custom-permissions/

A single machine-wide Amp plugin that evaluates `user-rules.json` over the maintained baseline in `builtin-rules.json`, then applies heuristic tighteners (`tighteners.ts`). Permission dialogs require a human response. The baseline preserves the previously imported Amp defaults without depending on the deprecated permission export. See [plugins/custom-permissions/README.md](plugins/custom-permissions/README.md) for activation details and risks. Run both test scripts after changing policy:

```bash
bun run scripts/test-custom-permissions.ts   # cascade + segment tests
bun run scripts/test-permissions-plugin.ts   # tightener heuristics tests
```

To audit an existing Amp thread for tool calls that would have required a
permission confirmation under these rules:

```bash
bun run scripts/analyze-thread-confirmations.ts T-019e50b7-d696-716e-bfde-f4482f809e6d
bun run scripts/analyze-thread-confirmations.ts <thread-id-or-url> --json
```

### skills/ast-grep

A skill for writing [ast-grep](https://ast-grep.github.io/) rules to perform structural code search, analysis, and rewriting. Translates natural-language queries into AST-pattern rules, tests them, and runs them against a codebase.

Usage from within Amp: ask to "find all async functions without error handling" or load the `ast-grep` skill.

### skills/1password

A skill for managing 1Password vaults and items through the `op` CLI. Use it when asked to retrieve, store, list, edit, or delete secrets, passwords, API tokens, or credentials in 1Password.

Usage from within Amp: ask to "get the staging API token from 1Password" or load the `1password` skill.

### skills/bitbucket-pr

A skill for interacting with Bitbucket Cloud pull requests: fetch PR details and comments, reply to review feedback, and push commits with Amp attribution.

Usage from within Amp: ask to "review this Bitbucket PR" or load the `bitbucket-pr` skill.

### skills/notify-slack

A skill for sending a Slack notification when a thread completes, needs attention, or hits an unresolved error. It uses the local `skills/notify-slack/toolbox/notify-slack` helper, which reads `status` and `summary` from stdin and uses `SLACK_WEBHOOK_URL` when present.

Usage from within Amp: this skill is loaded automatically by policy when a task completes or needs user attention; it can also be loaded explicitly as `notify-slack`.

### skills/tmux

A skill for managing background processes via `tmux`. Spawn new windows/panes for servers, watchers, or long-running tasks, then inspect their output without blocking the main session.

Usage from within Amp: ask to "run the dev server in the background" or load the `tmux` skill.

### skills/managing-master-threads

A skill for running a persistent master management thread. The master renames itself, only spawns/prompts/inspects tmux Amp child threads, and delegates all implementation, investigation, editing, and validation work to those children. It includes a narrow helper script for creating child Amp threads in tmux:

```bash
skills/managing-master-threads/scripts/spawn-amp-child-thread --name api-investigation --title "Child: API investigation" -- "Investigate the API issue and report back."
```

Usage from within Amp: ask to "start a master thread" or load the `managing-master-threads` skill.

### skills/ui-preview

A skill for previewing and screenshotting local dev servers and storybooks using Chrome DevTools (via MCP). Navigate pages, take screenshots, and analyze UI components.

Usage from within Amp: ask to "take a screenshot of the storybook" or load the `ui-preview` skill.

### plugins/handoff.ts

A user-wide command-palette plugin that starts a new thread from the current one via `amp threads handoff`, then opens it in tmux, iTerm, Terminal.app, or the browser depending on the environment.
