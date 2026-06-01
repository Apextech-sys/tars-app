"""
TARS Graph HTTP API server.

Exposes:
  GET  /health          — liveness check + node/edge counts
  POST /blast-radius    — Kuzu read-only blast-radius query (no LLM)

POST /blast-radius body:
  { "repo": "owner/repo", "file": "path/to/file.ts" }

Response:
  { "available": true, "file": "...", "callers": [...], "openPrs": [], "notes": "" }
"""
from __future__ import annotations

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

GRAPH_PATH = os.environ.get("TARS_GRAPH_PATH", "/data/graph.kuzu")
PORT = int(os.environ.get("TARS_GRAPH_PORT", "8765"))

def _open_ro(retries: int = 8, delay: float = 0.4):
    """Open the Kuzu DB read-only, retrying briefly on lock contention.

    A discovery/code-analysis writer holds an exclusive lock for short bursts;
    we retry so a blast-radius read lands as soon as the writer releases,
    instead of failing with available:false. Total wait ~3s by default.
    """
    import kuzu
    last = None
    for _ in range(retries):
        try:
            db = kuzu.Database(GRAPH_PATH, read_only=True)
            return kuzu.Connection(db), db
        except Exception as e:  # noqa: BLE001
            last = e
            if "lock" in str(e).lower():
                time.sleep(delay)
                continue
            raise
    raise last if last else RuntimeError("could not open graph")



def query_callers(repo: str, file: str) -> dict:
    """Blast-radius via the deterministic code graph (File + IMPORTS/CALLS).

    Returns the files that import or call `file` (importer -> imported edges),
    i.e. the blast radius of changing `file`. No LLM / embeddings involved.
    """
    try:
        import kuzu  # type: ignore
    except Exception as e:
        return {"available": False, "callers": [], "openPrs": [], "notes": f"kuzu not importable: {e}"}

    try:
        conn, db = _open_ro()
    except Exception as e:
        return {
            "available": False,
            "callers": [],
            "openPrs": [],
            "notes": f"graph open soft-fail: {e}",
        }

    # If the File table doesn't exist yet, degrade softly but stay available.
    try:
        target_rows = conn.execute(
            "MATCH (t:File {repo: $repo, path: $file}) RETURN count(t) AS n",
            {"repo": repo, "file": file},
        )
        target_exists = target_rows.has_next() and (target_rows.get_next()[0] or 0) > 0
    except Exception as e:
        return {
            "available": True,
            "callers": [],
            "openPrs": [],
            "notes": f"code graph not built yet: {e}",
        }

    if not target_exists:
        return {
            "available": True,
            "callers": [],
            "openPrs": [],
            "notes": f"file not found in code graph for repo {repo}",
        }

    callers: list[str] = []
    try:
        res = conn.execute(
            "MATCH (caller:File {repo: $repo})-[:IMPORTS|CALLS]->(target:File {repo: $repo, path: $file}) "
            "RETURN DISTINCT caller.path AS path ORDER BY path LIMIT 200",
            {"repo": repo, "file": file},
        )
        while res.has_next():
            row = res.get_next()
            p = row[0] if row else None
            if isinstance(p, str):
                callers.append(p)
    except Exception as e:
        return {
            "available": True,
            "callers": [],
            "openPrs": [],
            "notes": f"graph query soft-fail: {e}",
        }

    note = "" if callers else "no importers/callers found in code graph"
    return {"available": True, "callers": callers, "openPrs": [], "notes": note}


def get_graph_stats() -> dict:
    try:
        import kuzu  # type: ignore
        if not Path(GRAPH_PATH).exists():
            return {"nodes": 0, "edges": 0, "files": 0, "db_exists": False}
        conn, db = _open_ro(retries=4, delay=0.3)
        nodes, edges = -1, -1
        try:
            res = conn.execute("MATCH (n:Entity) RETURN count(*)")
            if res.has_next():
                nodes = res.get_next()[0] or 0
        except Exception:
            pass
        try:
            res = conn.execute("MATCH (r:RelatesToNode_) RETURN count(*)")
            if res.has_next():
                edges = res.get_next()[0] or 0
        except Exception:
            pass
        files = -1
        try:
            res = conn.execute("MATCH (f:File) RETURN count(*)")
            if res.has_next():
                files = res.get_next()[0] or 0
        except Exception:
            files = -1
        return {"nodes": nodes, "edges": edges, "files": files, "db_exists": True}
    except Exception as e:
        return {"nodes": -1, "edges": -1, "db_exists": Path(GRAPH_PATH).exists(), "error": str(e)}


class GraphHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        if args and "GET /health" in str(args[0]):
            return
        super().log_message(format, *args)

    def send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            stats = get_graph_stats()
            self.send_json(200, {
                "status": "ok",
                "graph_path": GRAPH_PATH,
                "db_exists": stats.get("db_exists", False),
                "nodes": stats.get("nodes", -1),
                "edges": stats.get("edges", -1),
                "files": stats.get("files", -1),
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/blast-radius":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                data = json.loads(body)
                repo = data.get("repo", "")
                file = data.get("file", "")
                if not repo or not file:
                    self.send_json(400, {"error": "repo and file are required"})
                    return
                result = query_callers(repo, file)
                result["file"] = file
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})
        else:
            self.send_json(404, {"error": "not found"})


def main() -> None:
    print(f"[tars-graph] Starting HTTP API on port {PORT}", flush=True)
    print(f"[tars-graph] Kuzu DB path: {GRAPH_PATH}", flush=True)
    stats = get_graph_stats()
    print(f"[tars-graph] DB exists: {stats['db_exists']}, nodes: {stats['nodes']}, edges: {stats['edges']}", flush=True)
    server = HTTPServer(("0.0.0.0", PORT), GraphHandler)
    print(f"[tars-graph] Listening on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
