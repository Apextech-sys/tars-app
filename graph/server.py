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

# Graphiti's DB (Entity / RelatesToNode_ stats only).
GRAPH_PATH = os.environ.get("TARS_GRAPH_PATH", "/data/graph.kuzu")
# Dedicated code-graph DB (File / IMPORTS / CALLS) — SOLE-writer code analyzer,
# separate from Graphiti so per-row incremental updates are stable. Blast-radius
# reads come from HERE. Falls back to GRAPH_PATH for legacy shared deployments.
CODE_GRAPH_PATH = os.environ.get("TARS_CODE_GRAPH_PATH", "/data/code-graph.kuzu")
PORT = int(os.environ.get("TARS_GRAPH_PORT", "8765"))

def _open_ro(path: str = CODE_GRAPH_PATH, retries: int = 8, delay: float = 0.4):
    """Open a Kuzu DB read-only, retrying briefly on lock contention.

    A writer holds an exclusive lock for short bursts; we retry so a read lands
    as soon as the writer releases, instead of failing. Total wait ~3s default.
    Defaults to the code-graph DB (the blast-radius source).
    """
    import kuzu
    last = None
    for _ in range(retries):
        try:
            db = kuzu.Database(path, read_only=True)
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


def list_docs() -> dict:
    """All ingested Notion docs + per-doc link counts (files/tickets/repos).
    Reads the code-graph DB (where Doc nodes live)."""
    try:
        conn, _db = _open_ro()
    except Exception as e:
        return {"available": False, "docs": [], "notes": f"graph open soft-fail: {e}"}
    docs: list[dict] = []
    try:
        res = conn.execute(
            "MATCH (d:Doc) "
            "OPTIONAL MATCH (d)-[:MENTIONS_FILE]->(f:File) "
            "OPTIONAL MATCH (d)-[:MENTIONS_TICKET]->(t:Ticket) "
            "OPTIONAL MATCH (d)-[:MENTIONS_REPO]->(r:DocRepo) "
            "RETURN d.notion_id, d.title, d.url, d.last_edited, d.ingested_at, "
            "count(DISTINCT f), count(DISTINCT t), count(DISTINCT r) "
            "ORDER BY d.ingested_at DESC LIMIT 500"
        )
        while res.has_next():
            row = res.get_next()
            docs.append({
                "notionId": row[0], "title": row[1], "url": row[2],
                "lastEdited": row[3], "ingestedAt": row[4],
                "fileCount": row[5] or 0, "ticketCount": row[6] or 0,
                "repoCount": row[7] or 0,
            })
    except Exception as e:
        return {"available": True, "docs": [], "notes": f"docs not ingested yet: {e}"}
    return {"available": True, "docs": docs, "notes": ""}


def get_doc(notion_id: str) -> dict:
    """One doc + its linked code files, tickets, and repos."""
    try:
        conn, _db = _open_ro()
    except Exception as e:
        return {"available": False, "notes": f"graph open soft-fail: {e}"}
    doc_id = f"notion::{notion_id}"
    try:
        head = conn.execute(
            "MATCH (d:Doc {id:$id}) RETURN d.notion_id, d.title, d.url, "
            "d.last_edited, d.ingested_at", {"id": doc_id})
        if not head.has_next():
            return {"available": True, "found": False, "notes": "doc not found"}
        h = head.get_next()
        doc = {"notionId": h[0], "title": h[1], "url": h[2],
               "lastEdited": h[3], "ingestedAt": h[4]}
        files, tickets, repos = [], [], []
        rf = conn.execute(
            "MATCH (d:Doc {id:$id})-[:MENTIONS_FILE]->(f:File) "
            "RETURN f.repo, f.path ORDER BY f.path", {"id": doc_id})
        while rf.has_next():
            row = rf.get_next()
            files.append({"repo": row[0], "path": row[1]})
        rt = conn.execute(
            "MATCH (d:Doc {id:$id})-[:MENTIONS_TICKET]->(t:Ticket) "
            "RETURN t.identifier, t.team, t.title, t.url ORDER BY t.identifier",
            {"id": doc_id})
        while rt.has_next():
            row = rt.get_next()
            tickets.append({"identifier": row[0], "team": row[1],
                            "title": row[2], "url": row[3]})
        rr = conn.execute(
            "MATCH (d:Doc {id:$id})-[:MENTIONS_REPO]->(r:DocRepo) "
            "RETURN r.full_name, r.url ORDER BY r.full_name", {"id": doc_id})
        while rr.has_next():
            row = rr.get_next()
            repos.append({"fullName": row[0], "url": row[1]})
        return {"available": True, "found": True, "doc": doc,
                "files": files, "tickets": tickets, "repos": repos}
    except Exception as e:
        return {"available": True, "found": False, "notes": f"query soft-fail: {e}"}


def docs_for_file(repo: str, file: str) -> dict:
    """Docs that explicitly mention a given code file (reverse of get_doc)."""
    try:
        conn, _db = _open_ro()
    except Exception as e:
        return {"available": False, "docs": [], "notes": f"graph open soft-fail: {e}"}
    fid = f"{repo}::{file}"
    docs: list[dict] = []
    try:
        res = conn.execute(
            "MATCH (d:Doc)-[:MENTIONS_FILE]->(f:File {id:$f}) "
            "RETURN d.notion_id, d.title, d.url ORDER BY d.title", {"f": fid})
        while res.has_next():
            row = res.get_next()
            docs.append({"notionId": row[0], "title": row[1], "url": row[2]})
    except Exception as e:
        return {"available": True, "docs": [], "notes": f"docs not ingested yet: {e}"}
    return {"available": True, "file": file, "docs": docs, "notes": ""}


def get_graph_stats() -> dict:
    """Health stats: Entity/edge counts from Graphiti's DB; File/IMPORTS counts
    from the dedicated code-graph DB. Each opened independently and soft-fails."""
    try:
        import kuzu  # type: ignore
    except Exception as e:
        return {"nodes": -1, "edges": -1, "files": -1, "db_exists": False, "error": str(e)}

    nodes, edges, files, imports = -1, -1, -1, -1
    graphiti_exists = Path(GRAPH_PATH).exists()
    code_exists = Path(CODE_GRAPH_PATH).exists()

    # Graphiti DB — Entity nodes + RelatesToNode_ edges
    if graphiti_exists:
        try:
            conn, db = _open_ro(GRAPH_PATH, retries=4, delay=0.3)
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
        except Exception:
            pass

    # Code-graph DB — File nodes + IMPORTS edges
    if code_exists:
        try:
            conn, db = _open_ro(CODE_GRAPH_PATH, retries=4, delay=0.3)
            try:
                res = conn.execute("MATCH (f:File) RETURN count(*)")
                if res.has_next():
                    files = res.get_next()[0] or 0
            except Exception:
                files = -1
            try:
                res = conn.execute("MATCH (:File)-[i:IMPORTS]->() RETURN count(i)")
                if res.has_next():
                    imports = res.get_next()[0] or 0
            except Exception:
                imports = -1
        except Exception:
            pass

    return {
        "nodes": nodes, "edges": edges, "files": files, "imports": imports,
        "db_exists": graphiti_exists, "code_graph_exists": code_exists,
    }


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
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.path)
        route = parsed.path
        if route == "/health":
            stats = get_graph_stats()
            docs_count = -1
            try:
                dl = list_docs()
                docs_count = len(dl.get("docs", [])) if dl.get("available") else -1
            except Exception:
                pass
            self.send_json(200, {
                "status": "ok",
                "graph_path": GRAPH_PATH,
                "code_graph_path": CODE_GRAPH_PATH,
                "db_exists": stats.get("db_exists", False),
                "code_graph_exists": stats.get("code_graph_exists", False),
                "nodes": stats.get("nodes", -1),
                "edges": stats.get("edges", -1),
                "files": stats.get("files", -1),
                "imports": stats.get("imports", -1),
                "docs": docs_count,
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        elif route == "/docs":
            self.send_json(200, list_docs())
        elif route == "/doc":
            qs = parse_qs(parsed.query)
            nid = (qs.get("id") or [""])[0]
            if not nid:
                self.send_json(400, {"error": "id query param required"})
                return
            self.send_json(200, get_doc(nid))
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
        elif self.path == "/file-docs":
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length))
                repo = data.get("repo", "")
                file = data.get("file", "")
                if not repo or not file:
                    self.send_json(400, {"error": "repo and file are required"})
                    return
                self.send_json(200, docs_for_file(repo, file))
            except Exception as e:
                self.send_json(500, {"error": str(e)})
        else:
            self.send_json(404, {"error": "not found"})


def main() -> None:
    print(f"[tars-graph] Starting HTTP API on port {PORT}", flush=True)
    print(f"[tars-graph] Graphiti DB: {GRAPH_PATH}", flush=True)
    print(f"[tars-graph] Code-graph DB: {CODE_GRAPH_PATH}", flush=True)
    stats = get_graph_stats()
    print(f"[tars-graph] nodes: {stats['nodes']}, edges: {stats['edges']}, "
          f"files: {stats['files']}, imports: {stats['imports']}", flush=True)
    server = HTTPServer(("0.0.0.0", PORT), GraphHandler)
    print(f"[tars-graph] Listening on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
