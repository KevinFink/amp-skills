# amp-skills

Custom [Amp](https://ampcode.com) skills and settings.

## Setup

Symlink the settings file so Amp reads it:

```bash
ln -sf "$(pwd)/settings.json" ~/.config/amp/settings.json
```

Register the skills directory so Amp can discover skills:

```bash
amp skills add ./skills/*
```

## Contents

### settings.json

Amp permissions with a safe-by-default policy:

- **Allow** — `bd` commands, read-only shell commands (e.g. `ls`, `grep`, `git status`, `git diff`), and safe formatting tools (`ruff format`, `ruff check --fix`).
- **Ask** — everything else, including any destructive or unfamiliar commands.

See the [Amp permissions docs](https://ampcode.com/manual) for the full rule format.

### skills/ast-grep

A skill for writing [ast-grep](https://ast-grep.github.io/) rules to perform structural code search, analysis, and rewriting. Translates natural-language queries into AST-pattern rules, tests them, and runs them against a codebase.

Usage from within Amp: ask to "find all async functions without error handling" or load the `ast-grep` skill.

### skills/bd-next

A skill for working through [Beads](https://github.com/anthropics/beads) tickets. When loaded, it picks the next ready ticket (or a specified one), starts a new Amp thread, and walks through the full lifecycle: showing the ticket, executing the work, committing, and closing.

Usage from within Amp: ask to "start the next bd ticket" or load the `bd-next` skill.

### skills/tmux

A skill for managing background processes via `tmux`. Spawn new windows/panes for servers, watchers, or long-running tasks, then inspect their output without blocking the main session.

Usage from within Amp: ask to "run the dev server in the background" or load the `tmux` skill.

### skills/ui-preview

A skill for previewing and screenshotting local dev servers and storybooks using Chrome DevTools (via MCP). Navigate pages, take screenshots, and analyze UI components.

Usage from within Amp: ask to "take a screenshot of the storybook" or load the `ui-preview` skill.
