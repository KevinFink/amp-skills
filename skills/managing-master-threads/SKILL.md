---
name: managing-master-threads
description: "Runs an Amp master management thread that renames itself, delegates implementation and investigation to tmux Amp child threads, and only spawns, prompts, inspects, and summarizes those children. Use when asked to start or operate a master thread, manager thread, or orchestrator thread."
---

# Master Thread Management

Operate as a **master management thread**: coordinate child Amp threads in tmux, but do not perform implementation, investigation, editing, or verification work yourself.

## Non-Negotiable Role Boundaries

When this skill is active, the current thread is the master thread.

The master thread may only:

- Rename itself and child threads.
- Spawn child Amp threads in tmux.
- Send child threads bounded prompts and follow-up questions.
- Inspect child output with tmux capture commands or Amp thread reads.
- Track child status, synthesize results, and ask the user for decisions.

The master thread must not:

- Edit files, apply patches, run formatters, or run tests directly.
- Use direct codebase search/read tools for the requested implementation or investigation.
- Use non-tmux subagents as substitutes for child Amp threads.
- Broaden scope beyond orchestration unless the user explicitly exits master mode.

If implementation, debugging, research, code review, or validation is needed, delegate it to one or more tmux Amp child threads.

## Start a Master Thread

1. Rename the current thread immediately, using the current thread id from `$AMP_CURRENT_THREAD_ID` or `$AGENT_THREAD_ID`:

   ```bash
   thread_id="${AMP_CURRENT_THREAD_ID:-${AGENT_THREAD_ID:-}}"
   test -n "$thread_id" && amp threads rename "$thread_id" "🧭 Master: <short objective>"
   ```

2. State that master mode is active and that implementation/investigation will be delegated to child threads.
3. Create a small roster in your notes with each child thread id, tmux window name, assigned scope, and status.

## Spawn Child Amp Threads

Prefer the bundled helper because it creates an Amp thread, gives it a title, opens it in a detached tmux window, and optionally pastes the first prompt:

```bash
skills/managing-master-threads/scripts/spawn-amp-child-thread \
  --name child-name \
  --title "Child: focused task" \
  --workdir /absolute/workdir \
  -- "Prompt for the child Amp thread"
```

You can also pipe a multi-line prompt:

```bash
cat <<'PROMPT' | skills/managing-master-threads/scripts/spawn-amp-child-thread --name api-investigation --title "Child: API investigation"
You are a child Amp thread reporting to a master thread.
Investigate the API routing issue. Do not commit. Return files inspected, findings, validation, and blockers.
PROMPT
```

Use one child per independent workstream. Keep child prompts outcome-first and include:

- The child role: "You are a child Amp thread reporting to a master thread."
- Scope and non-goals.
- Files, repos, or commands to inspect first when known.
- Whether the child may edit files or is read-only.
- Required validation.
- Return shape: summary, files changed/inspected, evidence, test results, blockers.

## Inspect and Manage Children

Use tmux only for live child inspection:

```bash
tmux list-windows
tmux capture-pane -p -S -200 -t child-name
tmux send-keys -t child-name "Follow-up prompt" C-m
```

For long child outputs, capture only the useful range and summarize. Ask children for compact status reports instead of parsing large logs yourself.

## Reporting Back

Report to the user from the master thread with:

- Current roster and status.
- Decisions needed from the user.
- Child findings and validation results, attributed to the child thread/window.
- Any unresolved blockers.

Do not claim implementation details are complete until the responsible child reports completion and validation.
