#!/usr/bin/env bash
# Usage: ./scripts/add-webhook-repo.sh <owner/repo> [--konverge]
# Registers a GitHub webhook on the given repo and adds it to the watchlist.
# Requires: GH_TOKEN env var, GITHUB_WEBHOOK_SECRET env var, DATABASE_URL env var

set -eo pipefail

REPO_KEY="${1:?Usage: $0 owner/repo [--konverge]}"
AUTO_FIX=true
NOTES="added via add-webhook-repo.sh"

if [ "${2:-}" = "--konverge" ]; then
  AUTO_FIX=false
  NOTES="Konverge repo — review only, auto_fix DISABLED"
fi

OWNER=$(echo "$REPO_KEY" | cut -d/ -f1)
REPO=$(echo "$REPO_KEY" | cut -d/ -f2)
WEBHOOK_URL="https://tars.apextech.group/api/webhooks/github"

GH_TOKEN=${GH_TOKEN:-$(grep '^GH_TOKEN=' /home/shaun/tars-app/.env.local | cut -d= -f2-)}
WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET:-$(grep '^GITHUB_WEBHOOK_SECRET=' /home/shaun/tars-app/.env.local | cut -d= -f2-)}

echo "Registering webhook on $REPO_KEY (auto_fix=$AUTO_FIX)..."

RESPONSE=$(curl -s -X POST   -H "Authorization: Bearer $GH_TOKEN"   -H 'Accept: application/vnd.github.v3+json'   "https://api.github.com/repos/${REPO_KEY}/hooks"   -d "{\"name\":\"web\",\"active\":true,\"events\":[\"pull_request\",\"push\"],\"config\":{\"url\":\"$WEBHOOK_URL\",\"content_type\":\"json\",\"secret\":\"$WEBHOOK_SECRET\",\"insecure_ssl\":\"0\"}}")

HOOK_ID=$(echo "$RESPONSE" | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r.get("id",""))' 2>/dev/null)

if [ -z "$HOOK_ID" ]; then
  echo "ERROR: Failed to register webhook:"
  echo "$RESPONSE"
  exit 1
fi

echo "GitHub hook registered: id=$HOOK_ID"

# Add to DB
DATABASE_URL=${DATABASE_URL:-$(grep '^DATABASE_URL=' /home/shaun/tars-app/.env.local | cut -d= -f2-)}
psql "$DATABASE_URL" << SQL
INSERT INTO repo_settings (repo_key, owner, repo, webhook_enabled, auto_fix, github_hook_id, notes)
VALUES ('$REPO_KEY', '$OWNER', '$REPO', true, $AUTO_FIX, $HOOK_ID, '$NOTES')
ON CONFLICT (repo_key) DO UPDATE SET
  webhook_enabled = true,
  auto_fix = $AUTO_FIX,
  github_hook_id = $HOOK_ID,
  notes = '$NOTES',
  updated_at = now();
SELECT repo_key, auto_fix, github_hook_id FROM repo_settings WHERE repo_key = '$REPO_KEY';
SQL

echo "Done. Repo $REPO_KEY is now in the watched list."
echo "Note: DNS CNAME tars.apextech.group must exist for webhooks to reach the tunnel."
