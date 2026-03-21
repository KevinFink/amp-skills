---
name: bd-create
description: "Creates a Beads ticket with rich metadata, outputting a handoff prompt compatible with bd-next. Use when starting a new Beads-tracked task and want to leverage the bd-next workflow."
---

# bd-create

Creates a Beads ticket with description, labels, and dependencies, then outputs a prompt formatted for immediate handoff to bd-next workflow.

## Quick Start

```bash
{baseDir}/scripts/bd-create \
  --title "Your ticket title" \
  --description "What needs to be done" \
  --label "frontend|backend|docs|devops" \
  --depends-on "TICKET-ID" \
  --repo "/path/to/repo"
```

## What This Skill Does

1. Creates a new Beads ticket in the specified repo with rich metadata
2. Automatically syncs before and after ticket creation (handles merge conflicts)
3. Outputs a formatted prompt ready for `handoff` tool with `follow: true`
4. The output is compatible with `bd-next` workflow — ticket is ready to pick up immediately

## Options

- `--title TEXT` (required): Ticket summary (short, clear title)
- `--description TEXT` (optional): Detailed description of work (why, what, acceptance criteria)
- `--label LABEL` (optional): Ticket category for routing (`frontend`, `backend`, `docs`, `devops`, or custom label)
- `--depends-on TICKET-ID` (optional): Create a dependency on another ticket (can be repeated)
- `--repo /path/to/repo` (required): Path to the repo where Beads is initialized (typically current working directory)

## Output

The script outputs a ready-to-use handoff prompt with:
- The new ticket ID
- Formatted goal for `handoff` tool
- Instructions to replace `CURRENT_THREAD_URL` with actual thread URL

## Integration with bd-next

Tickets created by bd-create are immediately ready for `bd ready` → `bd-next` pickup. Labels are automatically set to help route work.

## Example Workflow

```bash
# Create ticket
{baseDir}/scripts/bd-create \
  --title "Add dark mode toggle" \
  --description "Users want dark mode. Add toggle to settings, save preference in localStorage." \
  --label "frontend" \
  --repo "$(pwd)"

# Output appears with handoff prompt — use handoff tool to start new thread
# New thread picks it up with bd-next
```

## Important: Working Directory

All `bd` commands run from the specified `--repo` path (typically the current directory). The script captures this and ensures sync/push happen from the correct location.

## How It Works

1. Detects dolt DB location under `.beads/dolt/`
2. Syncs (fetch + reset) to avoid merge conflicts
3. Creates ticket with `bd create` using provided options
4. Pushes changes (with `--force` for metadata table conflicts)
5. Outputs a prompt formatted for `handoff` tool
6. Ticket status is `open` (ready to claim with `bd-next`)
