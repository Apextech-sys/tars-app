"""
TARS Graph in-container scheduler — Dokploy-native, no external cron.

Runs the discovery / ingestion workers on a fixed cadence inside the
long-running tars-graph container (launched in the background by
entrypoint.sh). Survives across Dokploy restarts because the service itself
is restart-policy managed; the schedule simply restarts with the container.

Cadence (mirrors the old VM-102 systemd-timer cadence):
  every ~15 min : knowledge ingestion + github discovery + CODE ANALYSIS
  every ~30 min : linear / vercel / supabase / slack discovery

All jobs hold the single Kuzu writer lock, so we run them SEQUENTIALLY from
one scheduler process (never two writers at once). Each job is wrapped so a
failure in one never kills the loop. The code-analysis job is LLM-free; the
graph-population jobs require OPENAI_API_KEY (embeddings).

Disable entirely with TARS_DISABLE_SCHEDULER=1.
Tune via TARS_SCHED_FAST_MIN (default 15) and TARS_SCHED_SLOW_MIN (default 30).
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

FAST_MIN = int(os.environ.get("TARS_SCHED_FAST_MIN", "15"))
SLOW_MIN = int(os.environ.get("TARS_SCHED_SLOW_MIN", "30"))


def _log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[scheduler {ts}] {msg}", flush=True)


def _run_module(module: str, extra_args: list[str] | None = None, timeout: int = 1800) -> None:
    """Run `python3 -m <module>` as a subprocess so each job gets a clean Kuzu
    connection (avoids holding driver state between runs) and is isolated from
    crashes."""
    cmd = [sys.executable, "-m", module] + (extra_args or [])
    started = time.time()
    try:
        res = subprocess.run(
            cmd, cwd="/app", capture_output=True, text=True, timeout=timeout,
        )
        dur = time.time() - started
        tail = (res.stdout or res.stderr or "").strip().splitlines()[-1:] or [""]
        _log(f"{module} rc={res.returncode} ({dur:.0f}s) :: {tail[0][:160]}")
    except subprocess.TimeoutExpired:
        _log(f"{module} TIMEOUT after {timeout}s")
    except Exception as e:  # noqa: BLE001
        _log(f"{module} ERROR {type(e).__name__}: {e}")


def fast_cycle() -> None:
    _log("fast cycle start (code-analysis + knowledge + github)")
    # 1) Code analysis FIRST — LLM-free, short write lock. INCREMENTAL update:
    #    diffs each repo's last-analyzed commit -> HEAD and re-parses only the
    #    changed files (seconds), instead of a full DROP+recreate every run.
    #    First run (no baseline) full-parses once, then subsequent runs diff.
    #    Writes the dedicated code-graph.kuzu (sole writer) so per-row updates
    #    are safe across process restarts.
    repos = os.environ.get(
        "TARS_CODE_REPOS",
        "Apextech-sys/tars-app,Apextech-Dev/reflex-connect-v2,Apextech-Dev/reflex-connect-aws"
    )
    if os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"):
        _run_module(
            "tars_graph.code_analyzer",
            ["update", "--repos", repos, "--clone", "--branch", "main"],
            timeout=900,
        )
    else:
        _log("code analysis skipped (no GH token)")
    # 2) Knowledge ingestion — fast, hash-guarded (skips when yamls unchanged).
    _run_module("tars_graph.knowledge_ingestion")
    # 2b) Notion ingestion — INCREMENTAL: lists pages, (re)ingests only those
    #     whose last_edited_time changed, removes deleted. A no-change run is a
    #     cheap list-only no-op. Skipped entirely when NOTION_API_KEY is absent.
    if os.environ.get("NOTION_API_KEY"):
        _run_module("tars_graph.notion_ingestion", timeout=600)
    else:
        _log("notion ingestion skipped (NOTION_API_KEY not set)")
    # 3) GitHub discovery LAST — the slow writer; runs after the code graph is
    #    already fresh so a long discovery write doesn't delay blast-radius.
    if os.environ.get("TARS_SKIP_GITHUB", "0") != "1":
        _run_module("tars_graph.github_discovery")
    _log("fast cycle done")


def slow_cycle() -> None:
    _log("slow cycle start (linear/vercel/supabase/slack/aws)")
    for mod, env_needed in (
        ("tars_graph.linear_discovery", "LINEAR_API_KEY"),
        ("tars_graph.vercel_discovery", "VERCEL_API_TOKEN"),
        ("tars_graph.supabase_discovery", "SUPABASE_ACCESS_TOKEN"),
        ("tars_graph.slack_discovery", "SLACK_BOT_TOKEN"),
        ("tars_graph.aws_discovery", "AWS_ACCESS_KEY_ID"),
    ):
        if os.environ.get(env_needed) or (
            mod.endswith("slack_discovery") and os.environ.get("SLACK_USER_TOKEN")
        ):
            _run_module(mod)
        else:
            _log(f"{mod} skipped ({env_needed} not set)")
    _log("slow cycle done")



_SLACK_CHANNEL = os.environ.get("TARS_MONITOR_SLACK_CHANNEL", "D0B5JSGPBHD")
_FRESHNESS_STATE = "/tmp/tars-freshness-state.json"
# (node label, friendly name, max-age hours, enabling-credential env var)
_FRESHNESS_CHECKS = [
    ("AwsResource", "AWS resources", 6, "AWS_ACCESS_KEY_ID"),
    ("AwsCost", "AWS cost", 6, "AWS_ACCESS_KEY_ID"),
    ("Doc", "Notion docs", 30, "NOTION_API_KEY"),
]


def _slack(text: str) -> None:
    import json as _json
    import urllib.request as _u
    tok = os.environ.get("SLACK_BOT_TOKEN")
    if not tok:
        _log("freshness: SLACK_BOT_TOKEN unset, cannot alert")
        return
    try:
        data = _json.dumps({"channel": _SLACK_CHANNEL, "text": text}).encode()
        req = _u.Request(
            "https://slack.com/api/chat.postMessage", data=data,
            headers={"Authorization": f"Bearer {tok}",
                     "Content-Type": "application/json"})
        _u.urlopen(req, timeout=10).read()
    except Exception as e:  # noqa: BLE001
        _log(f"freshness slack post failed: {e}")


def freshness_check() -> None:
    """Dead-man: alert if any enabled connector's newest ingested_at is stale."""
    import json as _json
    try:
        import kuzu  # type: ignore
    except Exception:  # noqa: BLE001
        return
    path = os.environ.get("TARS_CODE_GRAPH_PATH", "/data/code-graph.kuzu")
    try:
        conn = kuzu.Connection(kuzu.Database(path, read_only=True))
    except Exception as e:  # noqa: BLE001
        _log(f"freshness: cannot open graph ro ({e}) — skipping this cycle")
        return
    now = datetime.now(timezone.utc)
    stale = []
    for label, friendly, max_h, cred in _FRESHNESS_CHECKS:
        if not os.environ.get(cred):
            continue  # connector deliberately disabled — not a freshness concern
        try:
            r = conn.execute(
                f"MATCH (n:{label}) RETURN count(n), max(n.ingested_at)")
            if not r.has_next():
                continue
            cnt, latest = r.get_next()
            if not (cnt or 0) or not latest:
                stale.append(f"{friendly}: enabled but 0 rows")
                continue
            dt = datetime.fromisoformat(str(latest).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_h = (now - dt).total_seconds() / 3600.0
            if age_h > max_h:
                stale.append(f"{friendly}: {age_h:.1f}h old (limit {max_h}h)")
        except Exception as e:  # noqa: BLE001
            _log(f"freshness check {label} failed: {e}")
    try:
        with open(_FRESHNESS_STATE) as f:
            prev = _json.load(f).get("stale", [])
    except Exception:  # noqa: BLE001
        prev = []
    if stale and stale != prev:
        _slack("⚠️ TARS graph ingest STALE:\n• " + "\n• ".join(stale))
        _log(f"freshness ALERT: {stale}")
    elif not stale and prev:
        _slack("✅ TARS graph ingest recovered — all connectors fresh.")
        _log("freshness recovered")
    try:
        with open(_FRESHNESS_STATE, "w") as f:
            _json.dump({"stale": stale}, f)
    except Exception:  # noqa: BLE001
        pass


def main() -> None:
    if os.environ.get("TARS_DISABLE_SCHEDULER", "0") == "1":
        _log("TARS_DISABLE_SCHEDULER=1 — scheduler not running")
        return
    _log(f"scheduler online — fast={FAST_MIN}min slow={SLOW_MIN}min")
    # Stagger: let the entrypoint's startup ingest finish first.
    time.sleep(120)
    last_slow = 0.0
    while True:
        cycle_start = time.time()
        fast_cycle()
        if time.time() - last_slow >= SLOW_MIN * 60:
            slow_cycle()
            last_slow = time.time()
        try:
            freshness_check()
        except Exception as e:  # noqa: BLE001
            _log(f"freshness_check error: {e}")
        # sleep the remainder of the fast interval
        elapsed = time.time() - cycle_start
        sleep_s = max(60, FAST_MIN * 60 - elapsed)
        _log(f"sleeping {sleep_s/60:.1f}min until next fast cycle")
        time.sleep(sleep_s)


if __name__ == "__main__":
    main()
