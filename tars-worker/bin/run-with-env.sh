#!/usr/bin/env bash
set -euo pipefail
HERMES_ENV="/home/shaun/.hermes/.env"
eval "$(grep -E '^INFISICAL_(HOST|PROJECT_ID|MACHINE_CLIENT_ID|MACHINE_CLIENT_SECRET)=' "${HERMES_ENV}" | sed 's/^/export /')"
TOKEN=$(/usr/bin/infisical login --method=universal-auth --client-id="$INFISICAL_MACHINE_CLIENT_ID" --client-secret="$INFISICAL_MACHINE_CLIENT_SECRET" --domain="$INFISICAL_HOST" --plain --silent | tail -1)
set -a
source <(/usr/bin/infisical export --token="$TOKEN" --projectId="$INFISICAL_PROJECT_ID" --env=prod --domain="$INFISICAL_HOST" --format=dotenv)
set +a
unset OPENAI_API_KEY OPENAI_BASE_URL
export CODEX_HOME="${CODEX_HOME:-/home/shaun/.codex}"
cd /home/shaun/tars-app/tars-worker
exec "$@"
