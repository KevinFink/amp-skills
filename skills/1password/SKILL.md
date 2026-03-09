---
name: 1password
description: "Manages 1Password items using the op CLI. Use when asked to store, retrieve, list, edit, or delete secrets, passwords, API tokens, or credentials in 1Password."
---

# 1Password CLI Skill

Manage 1Password vaults and items using the `op` CLI.

## Account Selection

The user may have multiple 1Password accounts. Always use `--account` to target the correct one.

To discover available accounts:

```bash
op account list
```

If the user doesn't specify an account, list the available accounts and ask which one to use. Once identified, always pass `--account "<account-url>"` on every `op` command.

## Common Operations

### List vaults

```bash
op vault list --account "<account-url>"
```

### List items in a vault

```bash
op item list --vault "<vault-name>" --account "<account-url>"
```

### Get an item

```bash
op item get "<item-name-or-id>" --vault "<vault-name>" --account "<account-url>"
```

To reveal secret fields, add `--reveal`:

```bash
op item get "<item-name-or-id>" --vault "<vault-name>" --account "<account-url>" --reveal
```

### Create an item

```bash
op item create --vault "<vault-name>" --account "<account-url>" \
  --category "<category>" --title "<title>" \
  "field=value"
```

Common categories: `Login`, `Password`, `API Credential`, `Secure Note`, `Server`, `Database`.

### Edit an item

```bash
op item edit "<item-name-or-id>" --vault "<vault-name>" --account "<account-url>" \
  "field=new-value"
```

### Delete an item

```bash
op item delete "<item-name-or-id>" --vault "<vault-name>" --account "<account-url>"
```

To archive instead of permanently deleting:

```bash
op item delete "<item-name-or-id>" --vault "<vault-name>" --account "<account-url>" --archive
```

### Read a secret reference

```bash
op read "op://<vault>/<item>/<field>" --account "<account-url>"
```

### Inject secrets into a config file

```bash
op inject -i template.env -o .env --account "<account-url>"
```

## Important Notes

- **Always specify `--account`** to avoid authentication prompts for the wrong account.
- **Never log or display secret values** in output shown to the user unless they explicitly ask to see them.
- If authentication fails with a "prompt dismissed" error, ask the user to run `eval $(op signin --account "<account-url>")` first, then retry.
- When creating items, choose the most appropriate `--category` for the type of secret being stored.
- Use `--format=json` when you need to parse output programmatically.
