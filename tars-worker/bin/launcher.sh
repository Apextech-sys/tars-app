#!/usr/bin/env bash
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$(cd "${WORKER_DIR}/.." && pwd)"
cd "${WORKER_DIR}"

HERMES_ENV="${HERMES_ENV:-/home/shaun/.hermes/.env}"
if [[ ! -r "${HERMES_ENV}" ]]; then
  echo "[launcher] cannot read ${HERMES_ENV}" >&2
  exit 64
fi
eval "$(grep -E '^INFISICAL_(HOST|PROJECT_ID|MACHINE_CLIENT_ID|MACHINE_CLIENT_SECRET)=' "${HERMES_ENV}" | sed 's/^/export /')"

if [[ -z "${INFISICAL_HOST:-}" || -z "${INFISICAL_PROJECT_ID:-}" || -z "${INFISICAL_MACHINE_CLIENT_ID:-}" || -z "${INFISICAL_MACHINE_CLIENT_SECRET:-}" ]]; then
  echo "[launcher] missing INFISICAL_* env from ${HERMES_ENV}" >&2
  exit 65
fi

INFISICAL_BIN="${INFISICAL_BIN:-/usr/bin/infisical}"
TOKEN="$("${INFISICAL_BIN}" login \
  --method=universal-auth \
  --client-id="${INFISICAL_MACHINE_CLIENT_ID}" \
  --client-secret="${INFISICAL_MACHINE_CLIENT_SECRET}" \
  --domain="${INFISICAL_HOST}" \
  --plain --silent | tail -1)"

if [[ -z "${TOKEN}" ]]; then
  echo "[launcher] infisical login failed" >&2
  exit 66
fi

ENV_DOTENV="$("${INFISICAL_BIN}" export \
  --token="${TOKEN}" \
  --projectId="${INFISICAL_PROJECT_ID}" \
  --env=prod \
  --domain="${INFISICAL_HOST}" \
  --format=dotenv)"
set -a
source <(echo "${ENV_DOTENV}")
set +a

unset OPENAI_API_KEY
unset OPENAI_BASE_URL
export CODEX_HOME="${CODEX_HOME:-/home/shaun/.codex}"

: "${TARS_APP_DB_URL:?TARS_APP_DB_URL must be set from Infisical}"
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY must be set from Infisical}"
: "${TARS_WORKER_CALLBACK_SECRET:?TARS_WORKER_CALLBACK_SECRET must be set from Infisical}"

export NODE_ENV="${NODE_ENV:-production}"
export TARS_WORKER_ID="${TARS_WORKER_ID:-worker-$(hostname)-$$}"

NODE_BIN="${NODE_BIN:-/usr/bin/node}"
if [[ ! -x "${NODE_BIN}" ]]; then
  NODE_BIN="$(command -v node)"
fi

echo "[launcher] starting tars-worker (cwd=${WORKER_DIR}, worker_id=${TARS_WORKER_ID})"
exec "${NODE_BIN}" dist/tars-worker/src/index.js
