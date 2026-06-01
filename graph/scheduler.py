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
    # 1) Code analysis FIRST — LLM-free, short write lock. Single invocation
    #    rebuilds the whole code graph (DROP + recreate) so blast-radius is
    #    fresh and readable within seconds of the cycle starting.
    repos = os.environ.get(
        "TARS_CODE_REPOS", "Apextech-sys/tars-app,Apextech-sys/reflex-connect"
    )
    if os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"):
        _run_module(
            "tars_graph.code_analyzer",
            ["--repos", repos, "--clone", "--branch", "main"],
            timeout=900,
        )
    else:
        _log("code analysis skipped (no GH token)")
    # 2) Knowledge ingestion — fast, hash-guarded (skips when yamls unchanged).
    _run_module("tars_graph.knowledge_ingestion")
    # 3) GitHub discovery LAST — the slow writer; runs after the code graph is
    #    already fresh so a long discovery write doesn't delay blast-radius.
    if os.environ.get("TARS_SKIP_GITHUB", "0") != "1":
        _run_module("tars_graph.github_discovery")
    _log("fast cycle done")


def slow_cycle() -> None:
    _log("slow cycle start (linear/vercel/supabase/slack)")
    for mod, env_needed in (
        ("tars_graph.linear_discovery", "LINEAR_API_KEY"),
        ("tars_graph.vercel_discovery", "VERCEL_API_TOKEN"),
        ("tars_graph.supabase_discovery", "SUPABASE_ACCESS_TOKEN"),
        ("tars_graph.slack_discovery", "SLACK_BOT_TOKEN"),
    ):
        if os.environ.get(env_needed) or (
            mod.endswith("slack_discovery") and os.environ.get("SLACK_USER_TOKEN")
        ):
            _run_module(mod)
        else:
            _log(f"{mod} skipped ({env_needed} not set)")
    _log("slow cycle done")


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
        # sleep the remainder of the fast interval
        elapsed = time.time() - cycle_start
        sleep_s = max(60, FAST_MIN * 60 - elapsed)
        _log(f"sleeping {sleep_s/60:.1f}min until next fast cycle")
        time.sleep(sleep_s)


if __name__ == "__main__":
    main()
