---
name: bd-next
description: Start working on the next ready Beads ticket in a new thread
---

# bd-next

Use this skill when the user wants to start working on the next Beads ticket.

## Important: Centralized Issue Tracking

All issue tracking is centralized in **photoop-product**. The `bd` CLI must only be run from `~/photoop-product`. Code changes happen in the repo identified by the ticket's label (`photoop-app`, `photoop-backend`, `photoop-infrastructure`). Tickets without a label are product-level work done in `photoop-product` itself.

## Usage

Run the script to get the next ready ticket and instructions:

```bash
{baseDir}/scripts/bd-next [ticket_id]
```

- If no ticket ID is provided, it fetches the first ready ticket from `bd ready --json` (run in `~/photoop-product`)
- If a ticket ID is provided, it uses that specific ticket
- The ticket's label determines which repo to work in

The script outputs a prompt that instructs Amp to:
1. Navigate to the correct working repo (based on ticket label)
2. Show the ticket details with `bd show <id> --json` (from `~/photoop-product`)
3. Restate and expand acceptance criteria
4. Execute the work in the working repo
5. Create follow-up tickets in `~/photoop-product` as needed
6. Ask the user to verify
7. Finalize with `bd-finalize` which commits code in the working repo, closes the ticket and syncs in `photoop-product`, and pushes both repos
