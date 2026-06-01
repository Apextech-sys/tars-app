# =============================================================================
# TARS Graph — Python service: Kuzu + Graphiti + HTTP blast-radius API
#
# Exposes:
#   GET  /health          — liveness + node/edge counts
#   POST /blast-radius    — Kuzu read-only query (no LLM needed for blast path)
#
# Population (knowledge ingestion + GitHub discovery) runs on startup
# and requires OPENAI_API_KEY (for Graphiti node embeddings).
#
# Volume: /data  — Kuzu DB + knowledge yamls + logs
#
# Internal port: 8765 (TARS_GRAPH_PORT env)
# =============================================================================

FROM python:3.11-slim

# System deps — git + gh CLI for github_discovery.py; curl for healthcheck
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        curl \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update -qq && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY tars_graph/ ./tars_graph/
COPY knowledge/  ./knowledge/
COPY server.py   ./
COPY ingest.py   ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

VOLUME ["/data"]

ENV TARS_GRAPH_PATH=/data/graph.kuzu \
    TARS_KNOWLEDGE_DIR=/data/knowledge \
    TARS_AUDIT_PATH=/data/audit.jsonl \
    TARS_EVENTS_PATH=/data/events.jsonl \
    TARS_LAST_SEEN_DIR=/data/last_seen \
    TARS_LOG_PATH=/data/discovery.log \
    TARS_DATA_DIR=/data \
    TARS_GRAPH_PORT=8765 \
    GRAPHITI_TELEMETRY_ENABLED=false \
    PYTHONUNBUFFERED=1

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD curl -sf http://localhost:8765/health || exit 1

CMD ["./entrypoint.sh"]
