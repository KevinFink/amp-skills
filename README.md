# amp-skills

Custom [Amp](https://ampcode.com) skills and settings.

## Setup

Run the installer to symlink settings and plugins, then register skills:

```bash
./scripts/install.sh
```

Or perform the steps manually. Symlink the settings file so Amp reads it:

```bash
ln -sf "$(pwd)/settings.json" ~/.config/amp/settings.json
```

Symlink tracked plugins so Amp loads the same user-wide plugins on every machine:

```bash
mkdir -p ~/.config/amp/plugins
ln -sf "$(pwd)"/plugins/*.ts ~/.config/amp/plugins/
```

Register the skills directory so Amp can discover skills:

```bash
amp skills add ./skills/*
```

## Contents

### settings.json

Baseline Amp configuration (skills path, cache directory, update mode, disabled tools). All shell-command permission rules are owned by the permissions plugin below so they share a single modal UI. See the [Amp permissions docs](https://ampcode.com/manual) for the rule format.

### plugins/custom-permissions/

A single user-wide Amp plugin that replaces Amp's legacy permissions plugin. Snapshots Amp's built-in rules into `builtin-rules.json`, layers `amp.permissions` from settings.json on top, and applies heuristic tighteners (`tighteners.ts`) so every prompt uses the plugin's confirm modal. See [plugins/custom-permissions/README.md](plugins/custom-permissions/README.md) for activation steps and risks. Refresh the snapshot after Amp upgrades:

```bash
./scripts/refresh-builtin-permissions.sh
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

### skills/tmux

A skill for managing background processes via `tmux`. Spawn new windows/panes for servers, watchers, or long-running tasks, then inspect their output without blocking the main session.

Usage from within Amp: ask to "run the dev server in the background" or load the `tmux` skill.

### skills/ui-preview

A skill for previewing and screenshotting local dev servers and storybooks using Chrome DevTools (via MCP). Navigate pages, take screenshots, and analyze UI components.

Usage from within Amp: ask to "take a screenshot of the storybook" or load the `ui-preview` skill.
