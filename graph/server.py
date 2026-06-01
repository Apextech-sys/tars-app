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


def query_callers(repo: str, file: str) -> dict:
    try:
        import kuzu  # type: ignore
    except Exception as e:
        return {"available": False, "callers": [], "openPrs": [], "notes": f"kuzu not importable: {e}"}

    try:
        db = kuzu.Database(GRAPH_PATH, read_only=True)
        conn = kuzu.Connection(db)
        query = """
        MATCH (target:File {repo: $repo, path: $file})
        OPTIONAL MATCH (caller)-[r]->(target)
        WHERE caller.repo = $repo
        RETURN DISTINCT caller.path AS path
        LIMIT 50
        """
        try:
            res = conn.execute(query, {"repo": repo, "file": file})
            paths = []
            while res.has_next():
                row = res.get_next()
                p = row[0] if row else None
                if isinstance(p, str):
                    paths.append(p)
            return {"available": True, "callers": paths, "openPrs": [], "notes": ""}
        except Exception as e:
            # Graph is reachable but file node may not exist yet — still available:true
            return {
                "available": True,
                "callers": [],
                "openPrs": [],
                "notes": f"graph query soft-fail: {e}",
            }
    except Exception as e:
        return {
            "available": False,
            "callers": [],
            "openPrs": [],
            "notes": f"graph open soft-fail: {e}",
        }


def get_graph_stats() -> dict:
    try:
        import kuzu  # type: ignore
        if not Path(GRAPH_PATH).exists():
            return {"nodes": 0, "edges": 0, "db_exists": False}
        db = kuzu.Database(GRAPH_PATH, read_only=True)
        conn = kuzu.Connection(db)
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
        return {"nodes": nodes, "edges": edges, "db_exists": True}
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
