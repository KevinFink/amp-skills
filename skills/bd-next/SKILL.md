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
6. **STOP and ask the user for approval** — present a summary of changes, the commit message, and which repos will be pushed. Wait for explicit confirmation before proceeding.
7. Only after user approval: Finalize with `bd-finalize` (with `BD_FINALIZE_CONFIRMED=yes`) which commits code in the working repo, closes the ticket and syncs in `photoop-product`, and pushes both repos

## ⚠️ Critical: User Approval Required

**NEVER run `git commit`, `git push`, `bd close`, or `bd-finalize` without explicit user approval.** The agent MUST:
- Present a summary of all changes and proposed actions
- Ask the user "May I commit, close the ticket, and push?"
- Wait for an affirmative response ("yes", "go ahead", "ship it")
- Only then proceed with finalization using `BD_FINALIZE_CONFIRMED=yes`
