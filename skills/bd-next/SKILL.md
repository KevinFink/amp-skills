---
name: bd-next
description: Start working on the next ready Beads ticket in a new thread
---

# bd-next

Use this skill when the user wants to start working on the next Beads ticket.

## Important: Working Directory

The `bd` CLI must be run from the repo where Beads is initialized (the current working directory). The bd-next script captures the current directory at startup and runs all bd commands from there.

## ⚠️ Critical: Always Start a New Independent Thread

**The agent MUST use the `handoff` tool to start a new thread before doing any implementation work.** The current thread should only:
1. Select the ticket (run `bd-next` script or identify the ticket ID)
2. Gather context (ticket details, repo label, working directory)
3. **Start a new thread** using the `handoff` tool with `follow: true`

Use `follow: true` to switch to the new thread and begin working immediately. The new ticket is an independent task unrelated to the current thread's topic. The handoff goal should include: the ticket ID, the working repo path, and a summary of the acceptance criteria.

## Usage

Run the script to get the next ready ticket and instructions:

```bash
{baseDir}/scripts/bd-next [ticket_id]
```

- If no ticket ID is provided, it fetches the first ready ticket from `bd ready --json` (run in the current directory)
- If a ticket ID is provided, it uses that specific ticket
- The script runs all bd commands from the current working directory
- It automatically syncs before selecting/claiming (fetch+reset to avoid merge conflicts) and runs `bd dolt push --force` right after claiming (with a direct `dolt push --force` fallback if needed)

The script outputs a prompt — **use the `handoff` tool with `follow: true`** to create a new thread with that prompt as the goal and automatically switch to it. Do NOT start implementation in the current thread.

In the new thread:
1. Navigate to the correct working repo
2. Show the ticket details with `bd show <id> --json`
3. Restate and expand acceptance criteria
4. Execute the work in the working repo
5. Create follow-up tickets as needed
6. **STOP and ask the user for approval** — present a summary of changes, the commit message, and which repos will be pushed. **You MUST call `notify-slack` with status `needs_attention`** so the user knows you are waiting. Wait for explicit confirmation before proceeding.
7. Only after user approval: Finalize with `bd-finalize`, passing env vars to record completion metadata:
      ```bash
       AMP_THREAD_URLS="<space-separated Amp thread URLs>" \
       BD_CLOSE_NOTES="<brief summary of what was done>" \
       BD_FINALIZE_CONFIRMED=yes \
         <script_dir>/bd-finalize <ticket_id> <commit_message_file> <files...>
       ```
       - `AMP_THREAD_URLS`: Include the current thread URL and any prior thread URLs from handoffs (check the handoff goal for `Continuing work from thread ...` references).
       - `BD_CLOSE_NOTES`: A one-or-two sentence summary of what was accomplished.
       - The script automatically syncs (fetch+reset) before closing, then runs `bd dolt push --force` after closing (with fallback), captures the commit hash, and adds a structured completion comment to the ticket.
       - To add a comment manually: `bd comments add <ticket_id> "<text>"` (note: `bd comment` is not valid).

## ⚠️ Status Field Management

**Always use `bd update --status <value>` to change ticket status.** Do NOT use `bd set-state status=<value>` — that creates a state dimension label, not a status field change. The script automatically sets `--status in_progress` when claiming a ticket (line 75 in bd-next). For any other status updates:
```bash
bd update <ticket_id> --status closed
bd update <ticket_id> --status open
```

To verify the actual status field (not labels), check with:
```bash
bd show <ticket_id> --json | jq '.[0].status'
```

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
