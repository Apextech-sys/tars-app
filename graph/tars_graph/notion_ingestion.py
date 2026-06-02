"""
TARS Notion ingestion + deterministic doc->code/ticket linking.

INCREMENTAL by design (see memory `graph-updates-must-be-incremental`):
  - Per-page state (last_edited_time + content sha) persisted to
    TARS_NOTION_STATE_PATH (default /data/notion.state.json).
  - Each run lists pages; a page is (re)ingested ONLY when its
    last_edited_time changed (or it's new). Unchanged pages are skipped
    WITHOUT fetching their block content — so a no-change run is a cheap
    list-only no-op (seconds), never a full re-ingest.
  - Pages that disappear from the workspace are removed (node + edges).
  - An explicit FULL re-ingest is available via `ingest(..., full=True)` /
    CLI `--full` for baseline / recovery only.

STORAGE: Notion docs + their links live in the DEDICATED code-graph.kuzu DB
(same DB as File/IMPORTS) so the code-path/ticket/repo links are plain Kuzu
edges into nodes that already exist there. No OpenAI / Graphiti dependency —
this is the deterministic backbone the brief asks for.

  Node table  Doc(id, notion_id, title, url, last_edited, content_sha, ingested_at)  PK id
  Node table  Ticket(id, identifier, team, url)                                       PK id (identifier)
  Node table  Repo(id, full_name, url)                                                PK id (full_name)
  Rel  table  MENTIONS_FILE(Doc -> File)       doc explicitly references a code path
  Rel  table  MENTIONS_TICKET(Doc -> Ticket)   doc references REF-123 / APE-88 etc.
  Rel  table  MENTIONS_REPO(Doc -> Repo)       doc references owner/repo

LINKING is DETERMINISTIC (explicit refs only):
  - code paths     : regex for `lib/...ts`, `workflows/...ts`, `graph/...py`, etc.
                     edge created only if the path resolves to a real File node.
  - ticket refs    : regex `[A-Z]{2,6}-\d+` -> Ticket node (verified against
                     Linear when LINEAR_API_KEY present; otherwise stored as-is).
  - repo refs      : regex `owner/repo` against TARS_CODE_REPOS allow-list.

Env:
  NOTION_API_KEY        Notion internal-integration token (required for live fetch)
  NOTION_VERSION        Notion-Version header (default 2022-06-28)
  TARS_NOTION_QUERY     search query to scope the ingested doc set
                        (default: engineering-flavoured terms)
  TARS_NOTION_MAX_PAGES cap on pages per run (default 60) — bounds scope
  LINEAR_API_KEY        optional; resolves ticket titles/urls
  TARS_CODE_REPOS       comma-separated owner/repo allow-list for repo refs
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

DEFAULT_DB_PATH = os.environ.get("TARS_CODE_GRAPH_PATH", "/data/code-graph.kuzu")
STATE_PATH = os.environ.get("TARS_NOTION_STATE_PATH", "/data/notion.state.json")
NOTION_VERSION = os.environ.get("NOTION_VERSION", "2022-06-28")
DEFAULT_QUERY = os.environ.get(
    "TARS_NOTION_QUERY",
    "engineering architecture design spec graph code review pipeline",
)
MAX_PAGES = int(os.environ.get("TARS_NOTION_MAX_PAGES", "60"))

# ---- reference extraction ---------------------------------------------------

# Code paths: a dotted source file optionally prefixed by dir segments.
# Matches lib/db/tars-schema.ts, workflows/pr-review.ts, graph/server.py,
# graph/tars_graph/code_analyzer.py, pr-review.ts (bare), etc.
_CODE_EXT = r"(?:ts|tsx|js|jsx|mjs|cjs|py)"
_CODE_PATH_RE = re.compile(
    r"(?<![\w./-])"                       # left boundary
    r"((?:[\w.-]+/)*[\w.-]+\." + _CODE_EXT + r")"
    r"(?![\w])"
)
# Ticket refs: REF-9, APE-88, PLA-123 — 2-6 upper letters, dash, digits.
_TICKET_RE = re.compile(r"(?<![\w-])([A-Z]{2,6}-\d+)(?![\w-])")
# Repo refs: owner/repo (validated against the allow-list).
_REPO_RE = re.compile(r"(?<![\w./-])([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(?![\w/])")


def extract_refs(text: str, repo_allow: set[str], file_paths: set[str]
                 ) -> tuple[set[str], set[str], set[str]]:
    """Return (code_paths_present, ticket_ids, repo_names) found in `text`.

    code paths are filtered to those that resolve to a real File node
    (exact match, or a unique basename match for bare filenames).
    """
    tickets = {m.group(1) for m in _TICKET_RE.finditer(text)}

    repos: set[str] = set()
    for m in _REPO_RE.finditer(text):
        cand = m.group(1)
        if cand in repo_allow:
            repos.add(cand)

    # build a basename index for bare-filename resolution (e.g. "pr-review.ts")
    by_base: dict[str, list[str]] = {}
    for p in file_paths:
        by_base.setdefault(p.rsplit("/", 1)[-1], []).append(p)

    code: set[str] = set()
    for m in _CODE_PATH_RE.finditer(text):
        raw = m.group(1)
        if raw in file_paths:          # exact path match
            code.add(raw)
            continue
        if "/" not in raw:             # bare filename -> resolve if unambiguous
            cands = by_base.get(raw, [])
            if len(cands) == 1:
                code.add(cands[0])
        else:
            # path given but not an exact node; try suffix match (unique)
            suffix_hits = [p for p in file_paths if p.endswith("/" + raw) or p == raw]
            if len(suffix_hits) == 1:
                code.add(suffix_hits[0])
    return code, tickets, repos


# ---- Notion REST ------------------------------------------------------------

def _notion_req(path: str, method: str = "POST", body: Optional[dict] = None,
                token: Optional[str] = None) -> dict:
    token = token or os.environ.get("NOTION_API_KEY")
    if not token:
        raise RuntimeError("NOTION_API_KEY not set")
    url = f"https://api.notion.com/v1/{path.lstrip('/')}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def list_pages(token: Optional[str] = None, query: str = DEFAULT_QUERY,
               max_pages: int = MAX_PAGES) -> list[dict]:
    """List page objects via Notion search, scoped to `query`. Returns a bounded
    set of {id, title, url, last_edited_time}. Content is NOT fetched here."""
    out: list[dict] = []
    cursor: Optional[str] = None
    while len(out) < max_pages:
        body: dict = {
            "query": query,
            "filter": {"property": "object", "value": "page"},
            "page_size": min(100, max_pages - len(out)),
        }
        if cursor:
            body["start_cursor"] = cursor
        resp = _notion_req("search", body=body, token=token)
        for obj in resp.get("results", []):
            if obj.get("object") != "page":
                continue
            out.append({
                "id": obj["id"],
                "url": obj.get("url", ""),
                "last_edited_time": obj.get("last_edited_time", ""),
                "title": _page_title(obj),
            })
        if not resp.get("has_more"):
            break
        cursor = resp.get("next_cursor")
    return out[:max_pages]


def _page_title(obj: dict) -> str:
    props = obj.get("properties", {}) or {}
    for v in props.values():
        if v.get("type") == "title":
            parts = v.get("title", []) or []
            return "".join(p.get("plain_text", "") for p in parts).strip()
    return obj.get("id", "")


def fetch_page_text(page_id: str, token: Optional[str] = None,
                    max_blocks: int = 400) -> str:
    """Recursively collect plain text from a page's blocks. Bounded by
    max_blocks so a huge page can't blow up a run."""
    chunks: list[str] = []
    count = 0

    def walk(block_id: str):
        nonlocal count
        cursor = None
        while True:
            path = f"blocks/{block_id}/children?page_size=100"
            if cursor:
                path += f"&start_cursor={cursor}"
            resp = _notion_req(path, method="GET", token=token)
            for b in resp.get("results", []):
                if count >= max_blocks:
                    return
                count += 1
                chunks.append(_block_text(b))
                if b.get("has_children"):
                    walk(b["id"])
            if not resp.get("has_more") or count >= max_blocks:
                return
            cursor = resp.get("next_cursor")

    walk(page_id)
    return "\n".join(c for c in chunks if c)


def _block_text(block: dict) -> str:
    btype = block.get("type", "")
    payload = block.get(btype, {}) or {}
    rich = payload.get("rich_text") or payload.get("text") or []
    text = "".join(rt.get("plain_text", "") for rt in rich)
    # code blocks carry the actual file references we care about
    if btype == "code" and not text:
        text = "".join(rt.get("plain_text", "") for rt in (payload.get("rich_text") or []))
    return text


# ---- Kuzu schema ------------------------------------------------------------

DDL = [
    ("Doc",
     "CREATE NODE TABLE IF NOT EXISTS Doc("
     "id STRING, notion_id STRING, title STRING, url STRING, "
     "last_edited STRING, content_sha STRING, ingested_at STRING, "
     "PRIMARY KEY (id))"),
    ("Ticket",
     "CREATE NODE TABLE IF NOT EXISTS Ticket("
     "id STRING, identifier STRING, team STRING, title STRING, url STRING, "
     "PRIMARY KEY (id))"),
    ("DocRepo",
     "CREATE NODE TABLE IF NOT EXISTS DocRepo("
     "id STRING, full_name STRING, url STRING, PRIMARY KEY (id))"),
    ("MENTIONS_FILE", "CREATE REL TABLE IF NOT EXISTS MENTIONS_FILE(FROM Doc TO File)"),
    ("MENTIONS_TICKET", "CREATE REL TABLE IF NOT EXISTS MENTIONS_TICKET(FROM Doc TO Ticket)"),
    ("MENTIONS_REPO", "CREATE REL TABLE IF NOT EXISTS MENTIONS_REPO(FROM Doc TO DocRepo)"),
]


def ensure_schema(conn) -> None:
    for _name, ddl in DDL:
        conn.execute(ddl)


def _doc_id(notion_id: str) -> str:
    return f"notion::{notion_id}"


# ---- state ------------------------------------------------------------------

def _load_state() -> dict:
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    tmp = STATE_PATH + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(state, f, sort_keys=True)
        os.replace(tmp, STATE_PATH)
    except Exception as e:
        print(f"[notion] state save warn: {e}", file=sys.stderr)


# ---- Linear resolution (optional) ------------------------------------------

def resolve_tickets(identifiers: set[str]) -> dict[str, dict]:
    """Resolve ticket identifiers -> {identifier: {team, title, url}} via Linear.
    Best-effort: returns minimal records when LINEAR_API_KEY is absent or a
    ticket isn't found, so a ref still becomes a (thin) Ticket node."""
    out: dict[str, dict] = {}
    key = os.environ.get("LINEAR_API_KEY")
    for ident in identifiers:
        team = ident.split("-")[0]
        out[ident] = {"team": team, "title": "", "url": ""}
    if not key or not identifiers:
        return out
    try:
        q = {
            "query": "query($f: IssueFilter) { issues(filter: $f, first: 100) "
                     "{ nodes { identifier title url team { key } } } }",
            "variables": {"f": {"or": [
                {"number": {"eq": int(i.split("-")[1])}} for i in identifiers
                if i.split("-")[1].isdigit()
            ]}},
        }
        req = urllib.request.Request(
            "https://api.linear.app/graphql", data=json.dumps(q).encode(),
            headers={"Authorization": key, "Content-Type": "application/json"})
        data = json.loads(urllib.request.urlopen(req, timeout=30).read())
        for n in data.get("data", {}).get("issues", {}).get("nodes", []):
            ident = n.get("identifier")
            if ident in out:
                out[ident] = {"team": (n.get("team") or {}).get("key", ""),
                              "title": n.get("title", ""), "url": n.get("url", "")}
    except Exception as e:
        print(f"[notion] linear resolve soft-fail: {e}", file=sys.stderr)
    return out


# ---- graph helpers ----------------------------------------------------------

def _file_paths_for_repos(conn, repos: list[str]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for repo in repos:
        r = conn.execute("MATCH (f:File {repo:$r}) RETURN f.path", {"r": repo})
        s: set[str] = set()
        while r.has_next():
            row = r.get_next()
            if row and isinstance(row[0], str):
                s.add(row[0])
        out[repo] = s
    return out


def _delete_doc(conn, doc_id: str) -> None:
    for rel in ("MENTIONS_FILE", "MENTIONS_TICKET", "MENTIONS_REPO"):
        conn.execute(f"MATCH (d:Doc {{id:$id}})-[e:{rel}]->() DELETE e", {"id": doc_id})
    conn.execute("MATCH (d:Doc {id:$id}) DELETE d", {"id": doc_id})


def _upsert_doc_node(conn, doc_id: str, rec: dict) -> None:
    exists = conn.execute("MATCH (d:Doc {id:$id}) RETURN count(d)", {"id": doc_id})
    if exists.has_next() and (exists.get_next()[0] or 0) > 0:
        conn.execute(
            "MATCH (d:Doc {id:$id}) SET d.title=$t, d.url=$u, d.last_edited=$le, "
            "d.content_sha=$sha, d.ingested_at=$ts",
            {"id": doc_id, "t": rec["title"], "u": rec["url"], "le": rec["last_edited"],
             "sha": rec["content_sha"], "ts": rec["ingested_at"]})
    else:
        conn.execute(
            "CREATE (d:Doc {id:$id, notion_id:$nid, title:$t, url:$u, last_edited:$le, "
            "content_sha:$sha, ingested_at:$ts})",
            {"id": doc_id, "nid": rec["notion_id"], "t": rec["title"], "u": rec["url"],
             "le": rec["last_edited"], "sha": rec["content_sha"], "ts": rec["ingested_at"]})


def _merge_ticket(conn, ident: str, info: dict) -> None:
    ex = conn.execute("MATCH (t:Ticket {id:$id}) RETURN count(t)", {"id": ident})
    if ex.has_next() and (ex.get_next()[0] or 0) > 0:
        conn.execute("MATCH (t:Ticket {id:$id}) SET t.team=$tm, t.title=$ti, t.url=$u",
                     {"id": ident, "tm": info["team"], "ti": info["title"], "u": info["url"]})
    else:
        conn.execute(
            "CREATE (t:Ticket {id:$id, identifier:$id2, team:$tm, title:$ti, url:$u})",
            {"id": ident, "id2": ident, "tm": info["team"], "ti": info["title"], "u": info["url"]})


def _merge_repo(conn, full_name: str) -> None:
    ex = conn.execute("MATCH (r:DocRepo {id:$id}) RETURN count(r)", {"id": full_name})
    if ex.has_next() and (ex.get_next()[0] or 0) > 0:
        return
    conn.execute("CREATE (r:DocRepo {id:$id, full_name:$id2, url:$u})",
                 {"id": full_name, "id2": full_name, "u": f"https://github.com/{full_name}"})


def _link_doc(conn, doc_id: str, repo: str, code: set[str], tickets: set[str],
              repos: set[str]) -> dict:
    n_file = n_tic = n_repo = 0
    for path in sorted(code):
        fid = f"{repo}::{path}"
        conn.execute(
            "MATCH (d:Doc {id:$d}), (f:File {id:$f}) CREATE (d)-[:MENTIONS_FILE]->(f)",
            {"d": doc_id, "f": fid})
        n_file += 1
    for ident in sorted(tickets):
        conn.execute(
            "MATCH (d:Doc {id:$d}), (t:Ticket {id:$t}) CREATE (d)-[:MENTIONS_TICKET]->(t)",
            {"d": doc_id, "t": ident})
        n_tic += 1
    for rn in sorted(repos):
        conn.execute(
            "MATCH (d:Doc {id:$d}), (r:DocRepo {id:$r}) CREATE (d)-[:MENTIONS_REPO]->(r)",
            {"d": doc_id, "r": rn})
        n_repo += 1
    return {"files": n_file, "tickets": n_tic, "repos": n_repo}


# ---- main ingest ------------------------------------------------------------

def ingest(db_path: str = DEFAULT_DB_PATH, token: Optional[str] = None,
           query: str = DEFAULT_QUERY, max_pages: int = MAX_PAGES,
           full: bool = False, injected_pages: Optional[list[dict]] = None) -> dict:
    """Run one incremental ingest cycle.

    injected_pages: for tests / proof without the raw token — a list of
      {id, title, url, last_edited_time, text}. When provided, the Notion REST
      calls are skipped entirely and these pages are ingested directly.
    """
    import kuzu
    started = time.time()

    repos = [r.strip() for r in os.environ.get(
        "TARS_CODE_REPOS", "Apextech-sys/tars-app").split(",") if r.strip()]
    primary_repo = repos[0] if repos else "Apextech-sys/tars-app"
    repo_allow = set(repos)

    state = {} if full else _load_state()
    page_state: dict = {} if full else dict(state.get("pages", {}))

    # 1) LIST (cheap) — either injected or via Notion search.
    if injected_pages is not None:
        listing = [{"id": p["id"], "title": p.get("title", ""), "url": p.get("url", ""),
                    "last_edited_time": p.get("last_edited_time", "")} for p in injected_pages]
        text_by_id = {p["id"]: p.get("text", "") for p in injected_pages}
    else:
        listing = list_pages(token=token, query=query, max_pages=max_pages)
        text_by_id = {}

    current_ids = {p["id"] for p in listing}

    # 2) Decide which pages changed (incremental gate).
    changed: list[dict] = []
    skipped = 0
    for p in listing:
        prev = page_state.get(p["id"])
        if prev and prev.get("last_edited") == p["last_edited_time"] and not full:
            skipped += 1
            continue
        changed.append(p)

    # 3) Removed pages (present in state, absent now).
    removed_ids = [pid for pid in page_state if pid not in current_ids]

    db = kuzu.Database(db_path)
    conn = kuzu.Connection(db)
    ensure_schema(conn)
    file_paths = _file_paths_for_repos(conn, repos)
    all_paths = file_paths.get(primary_repo, set())

    # remove deleted docs
    for pid in removed_ids:
        _delete_doc(conn, _doc_id(pid))
        page_state.pop(pid, None)

    per_doc = []
    # pre-resolve all ticket refs across changed docs (one Linear call)
    pending_text: dict[str, str] = {}
    all_ticket_refs: set[str] = set()
    for p in changed:
        text = text_by_id.get(p["id"])
        if text is None:
            text = (p["title"] + "\n" + fetch_page_text(p["id"], token=token))
        else:
            text = p["title"] + "\n" + text
        pending_text[p["id"]] = text
        for m in _TICKET_RE.finditer(text):
            all_ticket_refs.add(m.group(1))
    ticket_info = resolve_tickets(all_ticket_refs)
    for ident, info in ticket_info.items():
        _merge_ticket(conn, ident, info)

    for p in changed:
        text = pending_text[p["id"]]
        sha = hashlib.sha1(text.encode("utf-8", "replace")).hexdigest()
        doc_id = _doc_id(p["id"])
        # replace links: drop old node+edges, recreate
        _delete_doc(conn, doc_id)
        rec = {"notion_id": p["id"], "title": p["title"], "url": p["url"],
               "last_edited": p["last_edited_time"], "content_sha": sha,
               "ingested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        _upsert_doc_node(conn, doc_id, rec)
        code, tickets, rrepos = extract_refs(text, repo_allow, all_paths)
        for rn in rrepos:
            _merge_repo(conn, rn)
        link = _link_doc(conn, doc_id, primary_repo, code, tickets, rrepos)
        page_state[p["id"]] = {"last_edited": p["last_edited_time"], "sha": sha}
        per_doc.append({"title": p["title"], "id": p["id"], **link})

    try:
        conn.execute("CHECKPOINT")
    except Exception:
        pass
    conn.close()
    db.close()

    state["pages"] = page_state
    state["last_run"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _save_state(state)

    return {
        "mode": "full" if full else "incremental",
        "listed": len(listing),
        "changed": len(changed),
        "skipped_unchanged": skipped,
        "removed": len(removed_ids),
        "docs": per_doc,
        "elapsed_s": round(time.time() - started, 2),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="TARS Notion ingestion (incremental)")
    ap.add_argument("--full", action="store_true", help="full re-ingest (baseline/recovery)")
    ap.add_argument("--query", default=DEFAULT_QUERY)
    ap.add_argument("--max-pages", type=int, default=MAX_PAGES)
    ap.add_argument("--db", default=DEFAULT_DB_PATH)
    args = ap.parse_args()
    if not os.environ.get("NOTION_API_KEY"):
        print("[notion] NOTION_API_KEY not set — skipping ingestion", flush=True)
        return
    stats = ingest(db_path=args.db, query=args.query, max_pages=args.max_pages, full=args.full)
    print(f"[notion] {json.dumps(stats)[:1000]}", flush=True)


if __name__ == "__main__":
    main()
