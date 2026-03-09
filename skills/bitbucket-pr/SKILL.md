---
name: bitbucket-pr
description: "Interacts with Bitbucket Cloud pull requests via the REST API. Use when reviewing, commenting on, or pushing changes to Bitbucket PRs. Handles authentication, fetching PR details/comments, replying to comments, and committing with Amp attribution."
---

# Bitbucket Pull Request Interaction

Interact with Bitbucket Cloud pull requests: fetch PR details, read comments, reply to review feedback, and push commits — all with proper Amp attribution.

## Credentials

Credentials are stored at `~/.config/atlassian/bitbucket_credentials.json`:

```json
{
  "username": "user@example.com",
  "token": "ATATT3x..."
}
```

If this file does not exist, check for a legacy token file at `~/.config/atlassian/bitbucket_pull_request_token.txt` (line 1: username, line 2: token). If neither exists, ask the user to create credentials:

1. Go to https://bitbucket.org/account/settings/app-passwords/
2. Create an app password with scopes: **Pull Request: Read**, **Pull Request: Write**, **Repository: Read**, **Repository: Write**
3. Save credentials to `~/.config/atlassian/bitbucket_credentials.json`

## Authentication

All API calls use HTTP Basic Auth:

```bash
curl -s -u "$USERNAME:$TOKEN" "https://api.bitbucket.org/2.0/..."
```

## Reading Credentials

Run `scripts/get-credentials.sh` to load credentials. It outputs `USERNAME` and `TOKEN` lines:

```bash
eval "$(scripts/get-credentials.sh)"
```

## API Reference

Base URL: `https://api.bitbucket.org/2.0/repositories/{workspace}/{repo_slug}`

### Parse a PR URL

Extract workspace, repo slug, and PR ID from a Bitbucket PR URL:

```
https://bitbucket.org/{workspace}/{repo_slug}/pull-requests/{pr_id}
```

### Get PR Details

```bash
curl -s -u "$USERNAME:$TOKEN" \
  "$BASE_URL/pullrequests/{pr_id}"
```

Key fields: `title`, `description`, `state`, `source.branch.name`, `destination.branch.name`, `comment_count`, `author.display_name`

### List PR Comments

```bash
curl -s -u "$USERNAME:$TOKEN" \
  "$BASE_URL/pullrequests/{pr_id}/comments"
```

Each comment contains:
- `id` — comment ID (use as `parent.id` when replying)
- `content.raw` — the comment text in markdown
- `user.display_name` — who wrote it
- `inline.path` — file path (for inline/code comments)
- `inline.to` — line number the comment is on
- `deleted` — whether the comment was deleted

Paginate with `?page=2` if `next` is present in the response.

### Reply to a Comment

```bash
curl -s -u "$USERNAME:$TOKEN" \
  -X POST -H "Content-Type: application/json" \
  -d '{"content":{"raw":"Your reply here"},"parent":{"id":COMMENT_ID}}' \
  "$BASE_URL/pullrequests/{pr_id}/comments"
```

### Add a General PR Comment

```bash
curl -s -u "$USERNAME:$TOKEN" \
  -X POST -H "Content-Type: application/json" \
  -d '{"content":{"raw":"Your comment here"}}' \
  "$BASE_URL/pullrequests/{pr_id}/comments"
```

### Add an Inline Comment on a File

```bash
curl -s -u "$USERNAME:$TOKEN" \
  -X POST -H "Content-Type: application/json" \
  -d '{"content":{"raw":"Your comment"},"inline":{"to":LINE_NUMBER,"path":"path/to/file"}}' \
  "$BASE_URL/pullrequests/{pr_id}/comments"
```

## Amp Attribution

### Commits

All commits made on behalf of the user MUST use Amp's author identity and reference the current thread:

```bash
THREAD_ID="${AMP_THREAD_ID:-${AGENT_THREAD_ID:-unknown}}"
THREAD_URL="https://ampcode.com/threads/${THREAD_ID}"

git commit \
  --author="Amp <amp@ampcode.com>" \
  -m "your commit message

Amp-Thread-ID: ${THREAD_URL}"
```

Rules:
- `--author="Amp <amp@ampcode.com>"` is REQUIRED on every commit
- The `Amp-Thread-ID:` trailer with the thread URL MUST be in the commit message body
- Only stage files directly related to the current task — never `git add -A` or `git add .`

### PR Comments

All PR comments posted via the API MUST be prefixed with an Amp attribution line:

```
🤖 *Posted by [Amp](https://ampcode.com) · [View thread](https://ampcode.com/threads/THREAD_ID)*

Your actual comment content here.
```

Build the prefix:
```bash
THREAD_ID="${AMP_THREAD_ID:-${AGENT_THREAD_ID:-unknown}}"
AMP_PREFIX="🤖 *Posted by [Amp](https://ampcode.com) · [View thread](https://ampcode.com/threads/${THREAD_ID})*\n\n"
```

## Workflows

### Review PR Comments

1. Parse the PR URL to extract workspace, repo slug, and PR ID
2. Load credentials via `scripts/get-credentials.sh`
3. Fetch PR details to understand context (title, branch, description)
4. Fetch all comments (paginate if needed)
5. Present comments to the user, grouped by file/location

### Address PR Feedback

1. Read the PR comments to understand what's requested
2. Check out the source branch if not already on it
3. Make the requested code changes
4. Commit with Amp attribution (see above)
5. Push to the source branch
6. Reply to each comment via the API with Amp-attributed responses explaining what was done

### Push Changes to PR

1. Stage only relevant files: `git add <specific files>`
2. Commit with `--author="Amp <amp@ampcode.com>"` and `Amp-Thread-ID` trailer
3. Push to the PR's source branch
