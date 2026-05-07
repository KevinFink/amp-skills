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

Amp permissions with a safe-by-default policy:

- **Allow** — read-only shell commands (e.g. `ls`, `grep`, `git status`, `git diff`) and safe formatting tools (`ruff format`, `ruff check --fix`).
- **Ask** — everything else, including any destructive or unfamiliar commands.

See the [Amp permissions docs](https://ampcode.com/manual) for the full rule format.

### plugins/ambiguous-shell-permissions.ts

A user-wide Amp plugin that asks for confirmation before ambiguous shell commands such as interpreter execution, destructive `find` usage, file-mutating `sed` usage, and mutating `gh` usage. It allows safe informational and syntax-check commands, including read-only `sed`, read-only `gh` actions such as `gh issue list` and `gh issue view`, `terraform validate`, `amp plugins list`, and `git status`.

Test it with:

```bash
bun run scripts/test-permissions-plugin.ts
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
