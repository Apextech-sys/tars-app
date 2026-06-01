#!/bin/sh
# TARS Graph container entrypoint.
# 1. Run initial ingest (knowledge yaml + GitHub discovery) in background
# 2. Start the HTTP API server (foreground)
set -e

DATA_DIR="${TARS_DATA_DIR:-/data}"
mkdir -p "${DATA_DIR}/knowledge" "${DATA_DIR}/last_seen"

echo "[tars-graph] Starting container..."
echo "[tars-graph] Data dir: ${DATA_DIR}"
echo "[tars-graph] Graph path: ${TARS_GRAPH_PATH:-/data/graph.kuzu}"

# Run ingest in background — HTTP server starts immediately, ingest populates in parallel
python3 /app/ingest.py &
INGEST_PID=$!
echo "[tars-graph] Ingest running in background (pid=${INGEST_PID})"

# Recurring discovery + code-analysis scheduler (in-container, no external cron)
python3 /app/scheduler.py &
SCHED_PID=$!
echo "[tars-graph] Scheduler running in background (pid=${SCHED_PID})"

# Start the HTTP API server (foreground)
exec python3 /app/server.py
