#!/usr/bin/env python3
"""
TARS Dead-man / Failure Monitor
Runs every ~2-3 min via cron (independent of tars-worker).
Three checks:
  1. worker_heartbeats stale > 5min -> ALERT
  2. pr_review_runs status in (error, fix-failed) recent -> ALERT
  3. >= 3 codex-review/claude-review failed tars_jobs in last window -> ALERT
De-dupes via /tmp/tars-monitor-state.json. Sends recovered msg when healthy.
Posts via Slack chat.postMessage to Shaun DM (D0B5JSGPBHD).
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
import psycopg2
from datetime import datetime, timezone, timedelta

# Config
SLACK_TOKEN = os.environ["SLACK_BOT_TOKEN"]
SLACK_CHANNEL = os.environ.get("TARS_MONITOR_SLACK_CHANNEL", "D0B5JSGPBHD")
DB_URL = os.environ["TARS_APP_DB_URL"]
STATE_FILE = "/tmp/tars-monitor-state.json"
HEARTBEAT_STALE_MIN = 5
FAILED_JOBS_THRESHOLD = 3
WINDOW_MINUTES = 30  # look-back window for failed jobs and pr errors


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def slack_post(text: str):
    payload = json.dumps({"channel": SLACK_CHANNEL, "text": text}).encode()
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=payload,
        headers={
            "Authorization": f"Bearer {SLACK_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.load(resp)
    if not result.get("ok"):
        print(f"[monitor] Slack error: {result.get('error')}", flush=True)
    else:
        print(f"[monitor] Slack posted ok, ts={result.get('ts')}", flush=True)
    return result


def db_connect():
    return psycopg2.connect(DB_URL)


def check_heartbeat(cur, now):
    """Returns (is_stale, age_minutes, worker_id) or (False, 0, None)"""
    cur.execute(
        "SELECT worker_id, last_seen, EXTRACT(EPOCH FROM (%s - last_seen))/60 AS age_min "
        "FROM worker_heartbeats ORDER BY last_seen DESC LIMIT 1",
        (now,)
    )
    row = cur.fetchone()
    if not row:
        return True, 999, "none"
    worker_id, last_seen, age_min = row
    is_stale = age_min > HEARTBEAT_STALE_MIN
    return is_stale, round(float(age_min), 1), worker_id


def check_pr_errors(cur, now):
    """Returns list of (run_id, repo, status, error) for recent errors."""
    window_start = now - timedelta(minutes=WINDOW_MINUTES)
    cur.execute(
        "SELECT run_id, repo, status, error FROM pr_review_runs "
        "WHERE status IN ('error','fix-failed') AND updated_at >= %s "
        "ORDER BY updated_at DESC LIMIT 10",
        (window_start,)
    )
    return cur.fetchall()


def check_failed_jobs(cur, now):
    """Returns count of failed codex-review/claude-review in last window."""
    window_start = now - timedelta(minutes=WINDOW_MINUTES)
    cur.execute(
        "SELECT count(*) FROM tars_jobs "
        "WHERE kind IN ('codex-review','claude-review') AND status = 'failed' "
        "AND completed_at >= %s",
        (window_start,)
    )
    row = cur.fetchone()
    return row[0] if row else 0


def main():
    now = datetime.now(timezone.utc)
    state = load_state()
    alerts = {}  # incident_key -> alert message

    try:
        conn = db_connect()
        cur = conn.cursor()
    except Exception as e:
        print(f"[monitor] DB connect failed: {e}", flush=True)
        sys.exit(1)

    try:
        # Check 1: heartbeat
        is_stale, age_min, worker_id = check_heartbeat(cur, now)
        if is_stale:
            alerts["heartbeat"] = (
                f":warning: TARS worker heartbeat STALE ({age_min}m ago, worker={worker_id}) "
                f"— worker may be down. Check `app-compress-neural-feed` container."
            )

        # Check 2: pr_review_runs errors
        pr_errors = check_pr_errors(cur, now)
        if pr_errors:
            lines = [f"  • `{r[0][:12]}` {r[1]} → *{r[2]}*: {(r[3] or '')[:120]}" for r in pr_errors]
            alerts["pr_errors"] = (
                f":x: TARS PR review errors in last {WINDOW_MINUTES}min ({len(pr_errors)} runs):\n"
                + "\n".join(lines)
            )

        # Check 3: failed jobs burst
        failed_count = check_failed_jobs(cur, now)
        if failed_count >= FAILED_JOBS_THRESHOLD:
            alerts["failed_jobs"] = (
                f":x: TARS review jobs: {failed_count} codex-review/claude-review failures "
                f"in last {WINDOW_MINUTES}min — possible provider outage."
            )

        conn.close()
    except Exception as e:
        print(f"[monitor] DB query error: {e}", flush=True)
        conn.close()
        sys.exit(1)

    new_state = {}
    now_ts = now.isoformat()

    for key, msg in alerts.items():
        prev = state.get(key, {})
        if not prev.get("firing"):
            # New alert — fire it
            print(f"[monitor] ALERT {key}: {msg[:100]}", flush=True)
            result = slack_post(f"*[TARS Monitor]* {msg}")
            new_state[key] = {
                "firing": True,
                "first_fired": now_ts,
                "last_ok": state.get(key, {}).get("last_ok"),
                "slack_ok": result.get("ok", False),
            }
        else:
            # Still firing — stay quiet (de-dup)
            new_state[key] = prev
            new_state[key]["last_check"] = now_ts
            print(f"[monitor] {key} still firing (de-dup, suppressed)", flush=True)

    # Recovered checks
    for key in state:
        if state[key].get("firing") and key not in alerts:
            first_fired = state[key].get("first_fired", "?")
            print(f"[monitor] RECOVERED {key}", flush=True)
            slack_post(
                f"*[TARS Monitor]* :white_check_mark: `{key}` RECOVERED "
                f"(was firing since {first_fired})"
            )
            new_state[key] = {"firing": False, "last_ok": now_ts}

    for key in state:
        if key not in new_state:
            new_state[key] = state[key]

    save_state(new_state)

    if not alerts:
        print(f"[monitor] All checks healthy at {now_ts}", flush=True)


if __name__ == "__main__":
    main()
