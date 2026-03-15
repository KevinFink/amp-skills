---
name: notify-slack
description: "Sends Slack notifications when a thread completes or needs user attention. Use at the end of every task or when blocked waiting for user input."
---

# Slack Notifications

Send a Slack message when you finish a task or need user attention.

## When to Notify

You MUST call the `notify-slack` tool in these situations:

1. **Task completed** — You finished the work the user asked for. Use status `completed`.
2. **Needs attention** — You are blocked and need user input to continue (e.g., a question, a choice, permission). Use status `needs_attention`.
3. **Error** — Something went wrong that you cannot resolve. Use status `error`.

## How to Use

The tool reads parameters from **stdin** in `key: value` format (one per line). Pipe them in using `printf`:

```bash
printf 'status: completed\nsummary: Your one-line summary here\n' | /home/ec2-user/amp-skills/skills/notify-slack/toolbox/notify-slack
```

**Parameters:**

- `status`: One of `completed`, `needs_attention`, or `error`
- `summary`: A short one-line summary of what happened or what you need

**⚠️ Do NOT pass parameters as CLI arguments or flags — they are ignored. Always pipe via stdin.**

The tool reads the Slack webhook URL from the `SLACK_WEBHOOK_URL` environment variable. If the variable is not set, the tool will silently skip sending (no error).

## Setup: Getting a Slack Webhook URL

1. Go to **https://api.slack.com/apps** and click **Create New App** → **From scratch**.
2. Name it (e.g. "Amp Notifications") and pick your workspace. Click **Create App**.
3. In the left sidebar, click **Incoming Webhooks** → toggle **Activate Incoming Webhooks** to **On**.
4. Scroll down and click **Add New Webhook to Workspace**.
5. Select the channel where you want notifications (e.g. `#amp-notifications` or a DM to yourself) and click **Allow**.
6. Copy the **Webhook URL** — it looks like `https://hooks.slack.com/services/T.../B.../xxxx`.
7. Set it as an environment variable before running Amp:
   ```bash
   export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T.../B.../xxxx"
   ```
   Or add it to your shell profile (`~/.bashrc`, `~/.zshrc`) for persistence.

You can create multiple webhook URLs pointing to different channels and swap them per environment.

## Important

- Always send a notification before ending your turn if the user is not actively watching.
- Keep the summary concise — one sentence max.
- Do NOT send notifications for intermediate steps, only at the end of your work or when blocked.
