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

### skills/bd-next

A skill for working through [Beads](https://github.com/anthropics/beads) tickets. When loaded, it picks the next ready ticket (or a specified one), starts a new Amp thread, and walks through the full lifecycle: showing the ticket, executing the work, committing, and closing.

Usage from within Amp: ask to "start the next bd ticket" or load the `bd-next` skill.
