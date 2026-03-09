---
name: bd-next
description: Start working on the next ready Beads ticket in a new thread
---

# bd-next

Use this skill when the user wants to start working on the next Beads ticket.

## Important: Centralized Issue Tracking

All issue tracking is centralized in **photoop-product**. The `bd` CLI must only be run from `~/photoop-product`. Code changes happen in the repo identified by the ticket's label (`photoop-app`, `photoop-backend`, `photoop-infrastructure`). Tickets without a label are product-level work done in `photoop-product` itself.

## ⚠️ Critical: Always Hand Off to a New Thread

**The agent MUST use the `handoff` tool to start a new thread before doing any implementation work.** The current thread should only:
1. Select the ticket (run `bd-next` script or identify the ticket ID)
2. Gather context (ticket details, repo label, working directory)
3. **Hand off to a new thread** using the `handoff` tool with `follow: true`

The handoff goal should include: the ticket ID, the working repo path, that all bd commands run from `~/photoop-product`, and a summary of the acceptance criteria. This prevents context degradation on longer tasks.

## Usage

Run the script to get the next ready ticket and instructions:

```bash
{baseDir}/scripts/bd-next [ticket_id]
```

- If no ticket ID is provided, it fetches the first ready ticket from `bd ready --json` (run in `~/photoop-product`)
- If a ticket ID is provided, it uses that specific ticket
- The ticket's label determines which repo to work in
- It automatically runs `bd dolt pull` before selecting/claiming and `bd dolt push` right after claiming (with a direct `dolt push` fallback if needed)

The script outputs a prompt — **use the `handoff` tool** to create a new thread with that prompt as the goal. Do NOT start implementation in the current thread.

In the new thread:
1. Navigate to the correct working repo (based on ticket label)
2. Show the ticket details with `bd show <id> --json` (from `~/photoop-product`)
3. Restate and expand acceptance criteria
4. Execute the work in the working repo
5. Create follow-up tickets in `~/photoop-product` as needed
6. **For `photoop-backend` tickets that touch Admin UI files:** run `~/photoop-infrastructure/scripts/refresh-admin-ui.sh` to restart the dev server, then tell the user to hard-refresh their browser (`Ctrl+Shift+R`) and verify the changes before proceeding.
7. **STOP and ask the user for approval** — present a summary of changes, the commit message, and which repos will be pushed. **You MUST call `notify-slack` with status `needs_attention`** so the user knows you are waiting. Wait for explicit confirmation before proceeding.
8. Only after user approval: Finalize with `bd-finalize`, passing env vars to record completion metadata:
      ```bash
      AMP_THREAD_URLS="<space-separated Amp thread URLs>" \
      BD_CLOSE_NOTES="<brief summary of what was done>" \
      BD_FINALIZE_CONFIRMED=yes \
        <script_dir>/bd-finalize <ticket_id> <commit_message_file> <files...>
      ```
      - `AMP_THREAD_URLS`: Include the current thread URL and any prior thread URLs from handoffs (check the handoff goal for `Continuing work from thread ...` references).
      - `BD_CLOSE_NOTES`: A one-or-two sentence summary of what was accomplished.
      - The script automatically runs `bd dolt pull` before closing, then `bd dolt push` after closing (with fallback), captures the commit hash, and adds a structured completion comment to the ticket.

## Testing Changes on Dev

### For photoop-backend Admin UI changes
After making code changes to the backend, refresh the dev server to ensure changes are visible:

```bash
cd ~/photoop-infrastructure
./scripts/refresh-admin-ui.sh
```

Then hard-refresh your browser (`Ctrl+Shift+R` on Chrome/Firefox, `Cmd+Shift+R` on Safari) to bypass caching.

**Why this is needed:** The dev server uses nginx caching (7-day expiry) for static assets. This script:
1. Restarts the backend server (picks up code changes)
2. Reloads nginx (clears in-flight connections)
3. Verifies the backend is healthy

See `~/photoop-infrastructure/scripts/refresh-admin-ui.sh` for details.

## Slack Notifications

**Use the `notify-slack` skill** to keep the user informed. Call the `notify-slack` tool:
- With status `completed` after finishing the work and pushing (or after presenting the approval summary).
- With status `needs_attention` when you are blocked and need user input (e.g., approval to commit/push, a design question, ambiguous requirements).
- With status `error` if something goes wrong that you cannot resolve.

## ⚠️ Critical: User Approval Required

**NEVER run `git commit`, `git push`, `bd close`, or `bd-finalize` without explicit user approval.** The agent MUST:
- Present a summary of all changes and proposed actions
- Ask the user "May I commit, close the ticket, and push?"
- Wait for an affirmative response ("yes", "go ahead", "ship it")
- Only then proceed with finalization using `BD_FINALIZE_CONFIRMED=yes`
