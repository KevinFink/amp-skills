#!/usr/bin/env bash

# Loads Bitbucket credentials from known locations.
# Outputs USERNAME and TOKEN as shell-evaluable lines.
#
# Usage: eval "$(scripts/get-credentials.sh)"

CRED_JSON="$HOME/.config/atlassian/bitbucket_credentials.json"
CRED_LEGACY="$HOME/.config/atlassian/bitbucket_pull_request_token.txt"

if [ -f "$CRED_JSON" ]; then
    USERNAME=$(python3 -c "import json; d=json.load(open('$CRED_JSON')); print(d['username'])")
    TOKEN=$(python3 -c "import json; d=json.load(open('$CRED_JSON')); print(d['token'])")
elif [ -f "$CRED_LEGACY" ]; then
    USERNAME=$(sed -n '1p' "$CRED_LEGACY")
    TOKEN=$(sed -n '2p' "$CRED_LEGACY")
else
    echo "ERROR: No Bitbucket credentials found." >&2
    echo "Create $CRED_JSON with {\"username\":\"...\",\"token\":\"...\"}" >&2
    exit 1
fi

echo "USERNAME='$USERNAME'"
echo "TOKEN='$TOKEN'"
