"""TARS visibility-always audit log.

Every dispatched action by any agent/skill appends a structured entry here.
The morning/evening briefings replay this since last brief — Shaun never
surprised.

Usage:
    from tars_graph.audit import log_action, audit
    log_action('devops', 'github_discovery', 'Apextech-sys/foo-bar', outcome='upserted',
               payload={'lang': 'TypeScript', 'archived': False})

    # Context-manager flavor for actions that may fail:
    async with audit('admin', 'create_linear_project', 'konverge/foo'):
        await admin.create_linear_project(...)
"""
from __future__ import annotations

import contextlib
import json
import os
import socket
import traceback
from datetime import datetime, timezone
from pathlib import Path


AUDIT_PATH = Path(os.environ.get('TARS_AUDIT_PATH', '/data/audit.jsonl'))
AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_action(
    actor: str,
    action: str,
    target: str = '',
    outcome: str = 'ok',
    correlation_id: str | None = None,
    payload: dict | None = None,
) -> None:
    """Append a structured action entry to the audit log. Synchronous, append-only.

    outcome convention:
      'ok'        — action succeeded
      'noop'      — nothing to do (idempotent re-run)
      'blocked'   — refused by guard (e.g. assert_writable)
      'queued'    — handed off to another actor
      'failed'    — exception raised; payload should include 'traceback'
      'skipped'   — explicitly skipped (with reason in payload)
    """
    entry = {
        'ts': _now_iso(),
        'host': socket.gethostname(),
        'actor': actor,
        'action': action,
        'target': target,
        'outcome': outcome,
    }
    if correlation_id:
        entry['correlation_id'] = correlation_id
    if payload:
        entry['payload'] = payload
    with AUDIT_PATH.open('a') as f:
        f.write(json.dumps(entry, separators=(',', ':')) + '\n')


@contextlib.asynccontextmanager
async def audit(
    actor: str, action: str, target: str = '',
    correlation_id: str | None = None,
    payload: dict | None = None,
):
    """Async context manager for action lifecycle. Logs success or failure
    with traceback. Use to wrap any modifying action:

        async with audit('devops', 'create_vercel_project', 'foo'):
            await devops.create_vercel_project('foo')
    """
    started = _now_iso()
    try:
        yield
    except Exception as e:
        fail_payload = dict(payload or {})
        fail_payload['exception_type'] = type(e).__name__
        fail_payload['exception_msg'] = str(e)[:500]
        fail_payload['traceback'] = traceback.format_exc()[-2000:]
        fail_payload['started'] = started
        log_action(actor, action, target, outcome='failed',
                   correlation_id=correlation_id, payload=fail_payload)
        raise
    log_action(actor, action, target, outcome='ok',
               correlation_id=correlation_id,
               payload={**(payload or {}), 'started': started})


@contextlib.contextmanager
def audit_sync(
    actor: str, action: str, target: str = '',
    correlation_id: str | None = None,
    payload: dict | None = None,
):
    """Synchronous version of audit() for non-async callsites."""
    started = _now_iso()
    try:
        yield
    except Exception as e:
        fail_payload = dict(payload or {})
        fail_payload['exception_type'] = type(e).__name__
        fail_payload['exception_msg'] = str(e)[:500]
        fail_payload['traceback'] = traceback.format_exc()[-2000:]
        fail_payload['started'] = started
        log_action(actor, action, target, outcome='failed',
                   correlation_id=correlation_id, payload=fail_payload)
        raise
    log_action(actor, action, target, outcome='ok',
               correlation_id=correlation_id,
               payload={**(payload or {}), 'started': started})


def read_since(since_iso: str | None = None, limit: int = 10000) -> list[dict]:
    """Return audit entries with ts >= since_iso (or all if None). For brief
    generation."""
    if not AUDIT_PATH.exists():
        return []
    out: list[dict] = []
    with AUDIT_PATH.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue
            if since_iso and entry.get('ts', '') < since_iso:
                continue
            out.append(entry)
            if len(out) >= limit:
                break
    return out
