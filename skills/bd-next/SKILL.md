---
name: bd-next
description: Start working on the next ready Beads ticket in a new thread
---

# bd-next

Use this skill when the user wants to start working on the next Beads ticket.

## Usage

Run the script to get the next ready ticket and instructions:

```bash
{baseDir}/scripts/bd-next [ticket_id]
```

- If no ticket ID is provided, it fetches the first ready ticket from `bd ready --json`
- If a ticket ID is provided, it uses that specific ticket

The script outputs a prompt that instructs Amp to:
1. Start a new thread for the ticket
2. Show the ticket details with `bd show <id> --json`
3. Restate acceptance criteria
4. Execute the work
5. Commit changes
6. Close the ticket with `bd close <id>`
7. Single amend to capture both pre-commit hook changes and beads state
