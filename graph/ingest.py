"""
TARS Graph ingest runner — called on container startup and by cron.

1. Copy bundled knowledge/*.yaml to /data/knowledge/ (if not already present)
2. Run knowledge_ingestion (projects.yaml + partners.yaml -> graph)
3. Run github_discovery (GitHub repos -> graph nodes/edges)

All steps are idempotent. Safe to run repeatedly.

Required env:
  OPENAI_API_KEY    — for Graphiti node embeddings (graph population)
  GH_TOKEN / GITHUB_TOKEN — for GitHub discovery

Optional env:
  TARS_SKIP_GITHUB          — set to 1 to skip GitHub discovery
  TARS_FORCE_KNOWLEDGE_COPY — set to 1 to overwrite knowledge yamls
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
from pathlib import Path

GRAPH_DIR = Path(__file__).parent
sys.path.insert(0, str(GRAPH_DIR))

DATA_DIR = Path(os.environ.get("TARS_DATA_DIR", "/data"))
KNOWLEDGE_DIR = Path(os.environ.get("TARS_KNOWLEDGE_DIR", "/data/knowledge"))
BUNDLED_KNOWLEDGE_DIR = GRAPH_DIR / "knowledge"


def ensure_data_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "last_seen").mkdir(parents=True, exist_ok=True)


def copy_bundled_knowledge() -> None:
    force = os.environ.get("TARS_FORCE_KNOWLEDGE_COPY", "0") == "1"
    for src in BUNDLED_KNOWLEDGE_DIR.glob("*.yaml"):
        dst = KNOWLEDGE_DIR / src.name
        if not dst.exists() or force:
            shutil.copy2(src, dst)
            print(f"[ingest] copied {src.name} -> {dst}", flush=True)
        else:
            print(f"[ingest] {src.name} already present, skipping copy", flush=True)


async def run_knowledge_ingestion() -> None:
    from tars_graph.knowledge_ingestion import main as ki_main
    print("[ingest] running knowledge ingestion ...", flush=True)
    try:
        await ki_main()
        print("[ingest] knowledge ingestion complete", flush=True)
    except Exception as e:
        print(f"[ingest] knowledge ingestion failed: {e}", flush=True)


async def run_github_discovery() -> None:
    if os.environ.get("TARS_SKIP_GITHUB", "0") == "1":
        print("[ingest] TARS_SKIP_GITHUB=1, skipping", flush=True)
        return
    if not (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")):
        print("[ingest] No GH_TOKEN/GITHUB_TOKEN, skipping GitHub discovery", flush=True)
        return
    from tars_graph.github_discovery import discover
    print("[ingest] running GitHub discovery ...", flush=True)
    try:
        await discover()
        print("[ingest] GitHub discovery complete", flush=True)
    except Exception as e:
        print(f"[ingest] GitHub discovery failed: {e}", flush=True)


async def run_code_analysis() -> None:
    """Build the deterministic code graph (File + IMPORTS) for tracked repos.

    LLM-free: tree-sitter import-graph only, no embeddings, no OpenAI cost.
    Repos come from TARS_CODE_REPOS (comma-separated owner/repo), default the
    repos that matter for blast-radius. Each repo is shallow-cloned via GH_TOKEN.
    """
    if os.environ.get("TARS_SKIP_CODE_ANALYSIS", "0") == "1":
        print("[ingest] TARS_SKIP_CODE_ANALYSIS=1, skipping code analysis", flush=True)
        return
    if not (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")):
        print("[ingest] No GH_TOKEN/GITHUB_TOKEN, skipping code analysis", flush=True)
        return
    repos_env = os.environ.get(
        "TARS_CODE_REPOS",
        "Apextech-sys/tars-app,Apextech-sys/reflex-connect",
    )
    repos = [r.strip() for r in repos_env.split(",") if r.strip()]
    from tars_graph.code_analyzer import run as analyze_run
    print(f"[ingest] running code analysis for {len(repos)} repo(s) ...", flush=True)
    for repo in repos:
        try:
            stats = analyze_run(repo, root=None, db_path=str(DATA_DIR / "graph.kuzu"), clone=True, branch="main")
            print(f"[ingest] code analysis {repo}: {stats}", flush=True)
        except Exception as e:
            print(f"[ingest] code analysis failed for {repo}: {e}", flush=True)
    print("[ingest] code analysis complete", flush=True)


async def main() -> None:
    print("[ingest] === TARS Graph ingest started ===", flush=True)
    ensure_data_dirs()
    copy_bundled_knowledge()
    if not os.environ.get("OPENAI_API_KEY"):
        print("[ingest] WARNING: OPENAI_API_KEY not set — graph population requires embeddings", flush=True)
    await run_knowledge_ingestion()
    await run_github_discovery()
    await run_code_analysis()
    print("[ingest] === TARS Graph ingest finished ===", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
