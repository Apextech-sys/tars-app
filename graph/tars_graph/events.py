"""
TARS events stream — discovery diffs + webhook arrivals flow here.

Departments tail this file for events they care about. Idempotent on event_id
(consumers dedupe).

Event shape:
  {
    "event_id": "uuid",
    "ts": "...",
    "type": "new_repo" | "removed_repo" | "new_linear_team" | ...,
    "source": "github" | "linear" | "vercel" | "supabase" | "slack" |
              "knowledge-yaml" | "webhook:github" | ...,
    "payload": { ... source-specific fields ... },
    "correlation_id": optional grouping ID
  }
"""
from __future__ import annotations

import json
import os
import socket
import uuid
from datetime import datetime, timezone
from pathlib import Path


EVENTS_PATH = Path(os.environ.get('TARS_EVENTS_PATH', '/data/events.jsonl'))
EVENTS_PATH.parent.mkdir(parents=True, exist_ok=True)


def emit_event(
    type: str,
    source: str,
    payload: dict | None = None,
    correlation_id: str | None = None,
) -> str:
    """Append an event to the stream. Returns the event_id.

    Common types:
      new_repo, removed_repo, archived_repo
      new_linear_team, removed_linear_team
      new_vercel_project, removed_vercel_project
      new_supabase_project, removed_supabase_project
      new_slack_channel, removed_slack_channel
      knowledge_yaml_changed
      webhook_received

    Sources:
      github, linear, vercel, supabase, slack, knowledge-yaml,
      webhook:<system>, manual
    """
    event_id = str(uuid.uuid4())
    entry = {
        'event_id': event_id,
        'ts': datetime.now(timezone.utc).isoformat(),
        'host': socket.gethostname(),
        'type': type,
        'source': source,
        'payload': payload or {},
    }
    if correlation_id:
        entry['correlation_id'] = correlation_id
    with EVENTS_PATH.open('a') as f:
        f.write(json.dumps(entry, separators=(',', ':')) + '\n')
    return event_id


def read_events(
    since_iso: str | None = None,
    types: list[str] | None = None,
    sources: list[str] | None = None,
    limit: int = 10000,
) -> list[dict]:
    """Read events. since_iso filters by ts >=. Returns list."""
    if not EVENTS_PATH.exists():
        return []
    out: list[dict] = []
    with EVENTS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            if since_iso and e.get('ts', '') < since_iso:
                continue
            if types and e.get('type') not in types:
                continue
            if sources and e.get('source') not in sources:
                continue
            out.append(e)
            if len(out) >= limit:
                break
    return out


# ===== diff detection helpers =====
# Each worker keeps a snapshot of "what I saw last run" at:
#   ~/.tars-state/last_seen/<source>.json
# On next run, the worker computes set differences and emits new_/removed_ events.

LAST_SEEN_DIR = Path(os.environ.get('TARS_LAST_SEEN_DIR', '/data/last_seen'))
LAST_SEEN_DIR.mkdir(parents=True, exist_ok=True)


def load_last_seen(source: str) -> set[str]:
    """Return the set of entity IDs seen on the previous run of this source."""
    p = LAST_SEEN_DIR / f'{source}.json'
    if not p.exists():
        return set()
    try:
        return set(json.loads(p.read_text()))
    except Exception:
        return set()


def save_last_seen(source: str, ids: set[str]) -> None:
    p = LAST_SEEN_DIR / f'{source}.json'
    p.write_text(json.dumps(sorted(ids)))


def diff_and_emit(
    source: str,
    new_event_type: str,
    removed_event_type: str,
    current_ids: set[str],
    payloads: dict[str, dict] | None = None,
) -> tuple[set[str], set[str]]:
    """Compare current_ids against last-seen snapshot. Emit new_/removed_ events
    for each diff. Persist current as the new snapshot. Returns (added, removed).

    First-run behavior: if no snapshot exists yet for this source, treat
    current state as the baseline — save the snapshot and emit NO events.
    This prevents flooding the events stream with "everything is new" on
    initial deployment. Subsequent runs detect real diffs.
    """
    snapshot_path = LAST_SEEN_DIR / f'{source}.json'
    is_first_run = not snapshot_path.exists()
    prev = load_last_seen(source)
    added = current_ids - prev
    removed = prev - current_ids
    save_last_seen(source, current_ids)
    if is_first_run:
        # Baseline mode — record what's there, emit nothing
        return set(), set()
    payloads = payloads or {}
    for eid in sorted(added):
        emit_event(
            type=new_event_type,
            source=source,
            payload={'id': eid, **(payloads.get(eid) or {})},
        )
    for eid in sorted(removed):
        emit_event(
            type=removed_event_type,
            source=source,
            payload={'id': eid},
        )
    return added, removed
