# custom-permissions

A drop-in replacement for Amp's legacy permissions plugin. When activated it
evaluates the same `amp.permissions` user rules + a snapshotted copy of Amp's
built-in rules, but every prompt uses the plugin's confirm modal instead of
Amp's built-in modal.

This plugin is installed by `scripts/install.sh` in this repository. The script
symlinks top-level plugins from `plugins/*.ts` and also explicitly symlinks this
plugin as `~/.config/amp/plugins/custom-permissions.ts`.

## How it works

```diagram
╭───────────────────────────────────────────────────╮
│ tool.call event                                   │
│   1. Walk amp.permissions (user rules) in order    │
│   2. Walk builtin-rules.json in order              │
│   3. First match wins                              │
│      allow  → return allow                         │
│      reject → return reject-and-continue           │
│      ask    → ctx.ui.confirm(...) → allow|reject   │
│   4. No match → ask via ctx.ui.confirm             │
╰───────────────────────────────────────────────────╯
```

Pattern syntax matches Amp's: globs use `*`; values wrapped in `/.../` are
treated as JS regex.

## Activating

1. Refresh the snapshot of Amp's built-in rules (re-run after every Amp
   upgrade so you keep current safe defaults):
   ```bash
   ./scripts/refresh-builtin-permissions.sh
   ```
2. Symlink the plugin into Amp's plugin directory, or run `./scripts/install.sh`:
   ```bash
   ln -sf "$(pwd)/plugins/custom-permissions/custom-permissions.ts" \
       ~/.config/amp/plugins/
   ```
   (`builtin-rules.json` is loaded relative to the symlink, so Bun resolves
   it through the symlink target — no extra link needed.)
3. Set `amp.dangerouslyAllowAll: true` in
   [../../settings.json](../../settings.json) so Amp's legacy permissions
   plugin loads but allows everything (otherwise you'd see two prompts per
   call). Keep `amp.permissions` in settings.json — this plugin still reads
   it as the user rule list.

## Verifying before flipping the switch

Before setting `dangerouslyAllowAll: true`, run the unit tests to confirm
the cascade behavior matches Amp's:
```bash
bun run scripts/test-custom-permissions.ts
```

## Tighteners

The heuristic checks that used to live in
`plugins/ambiguous-shell-permissions.ts` are now imported from
[`tighteners.ts`](tighteners.ts) and applied *after* the rule cascade. If the
cascade allows but a tightener returns `ask`, the plugin still prompts (e.g.,
`sed -i`, `python -c`, `git worktree remove`, `local_psql.sh --write`,
`find -delete`). This way there's a single plugin and a single confirm
modal — no double-prompts.

The plugin also records the current `agent.start` message and treats `git add`
and `git commit` as context-sensitive: they prompt by default, but are allowed
automatically during turns where the user explicitly asked to commit/land/ship
the current work.

## Thread title statuses

Thread title status handling lives in [`thread-title-status.ts`](thread-title-status.ts)
so multiple status detectors can share one priority-ordered rename queue.

- `⚠️` marks an active custom-permissions prompt. It is applied while the
  plugin waits on approval/rejection and removed as soon as the prompt resolves.
- `🙋` marks a thread whose final assistant output appears to be waiting on user
  action rather than a tool approval, such as "Not committed or pushed" or
  "Not pushed or landed yet". It is set from [`thread-wait-status.ts`](thread-wait-status.ts)
  on `agent.end` and cleared on the next `agent.start` or when a later turn no
  longer matches the wait patterns.

The manager strips known prefixes before applying a new one, and `⚠️` has higher
priority than `🙋` while both statuses are active.

## Risks

- **Drift.** Built-in rules change between Amp versions. Re-run
  `refresh-builtin-permissions.sh` after upgrades.
- **Plugin failure under `dangerouslyAllowAll: true`.** If this plugin
  fails to load, Amp will run *every* command unchallenged. Watch the logs
  after enabling.
