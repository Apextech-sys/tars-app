"""
TARS code-understanding layer — deterministic, LLM-free import-graph analyzer.

Parses a repo's source files with tree-sitter and stores a structural code
graph in a DEDICATED Kuzu DB (TARS_CODE_GRAPH_PATH, default
/data/code-graph.kuzu) — SEPARATE from Graphiti's /data/graph.kuzu.

  Node table  File(id, repo, path, language, symbol_count)   PK (id = repo::path)
  Rel  table  IMPORTS(File -> File)        importer -> imported  (resolved)
  Rel  table  CALLS(File -> File)          file-level call edge (best-effort)

Why a dedicated DB: when these tables shared graph.kuzu with Graphiti's tables,
two processes checkpointed the same DB and Kuzu 0.11.3 raised `unordered_map::at`
on per-row node DELETE across runs — which forced a full DROP+recreate every
run (the anti-pattern). With the code-analyzer as the SOLE writer of
code-graph.kuzu, per-row DELETE/MERGE is stable across process restarts
(verified), enabling TRUE incremental updates.

Edge direction: IMPORTS goes importer -> imported, so the blast-radius query
`(caller)-[:IMPORTS]->(target)` returns the files that depend on `target`.

Languages: TypeScript / TSX / JavaScript / JSX / Python.

Update model
------------
- `update` (DEFAULT per-PR/push path): for each repo, diff the last-analyzed
  commit -> HEAD (`git diff --name-status`). For each changed source file:
    * deleted   -> DELETE its File node + edges
    * added/mod -> DELETE its existing node+outgoing edges, re-parse THAT file,
                   re-insert node + IMPORTS edges
  Unchanged files are left untouched. Per-file content hashes are tracked so a
  re-run with no new commits is a near-instant no-op. Seconds, not minutes.
- `rebuild` (explicit baseline / recovery ONLY): DROP + recreate the tables and
  re-parse every repo in full. NOT the per-update path.

State (per-repo last commit + per-file hash) is persisted to
TARS_CODE_STATE_PATH (default /data/code-graph.state.json).

Usage:
  python3 -m tars_graph.code_analyzer rebuild --repos owner/a,owner/b --clone
  python3 -m tars_graph.code_analyzer update  --repos owner/a,owner/b --clone
  python3 -m tars_graph.code_analyzer update  --repo owner/a --root /checkout \
      --files lib/x.ts,lib/y.ts          # explicit changed-file list (webhook)

Back-compat: `--repo`/`--repos` with no subcommand defaults to `update`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Iterable, Optional

# Dedicated code-graph DB — NOT Graphiti's graph.kuzu.
DEFAULT_DB_PATH = os.environ.get("TARS_CODE_GRAPH_PATH", "/data/code-graph.kuzu")
STATE_PATH = os.environ.get("TARS_CODE_STATE_PATH", "/data/code-graph.state.json")

# ---- file selection ---------------------------------------------------------

TS_JS_EXTS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"}
PY_EXTS = {".py"}
SOURCE_EXTS = TS_JS_EXTS | PY_EXTS

EXCLUDE_DIRS = {
    "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
    ".turbo", ".vercel", "__pycache__", ".venv", "venv", ".mypy_cache",
    ".pytest_cache", "vendor", ".cache", "public", "e2e", "tests-examples",
}

TS_RESOLVE_SUFFIXES = [
    ".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs",
    "/index.ts", "/index.tsx", "/index.js", "/index.jsx",
]


def lang_for(path: Path) -> Optional[str]:
    ext = path.suffix.lower()
    if ext in (".ts", ".mts", ".cts"):
        return "typescript"
    if ext == ".tsx":
        return "tsx"
    if ext in (".js", ".jsx", ".mjs", ".cjs"):
        return "javascript"
    if ext == ".py":
        return "python"
    return None


def is_source_rel(rel: str) -> bool:
    """True if a repo-relative path is an analyzable source file (and not in an
    excluded directory)."""
    p = Path(rel)
    if p.suffix.lower() not in SOURCE_EXTS:
        return False
    parts = set(p.parts)
    if parts & EXCLUDE_DIRS:
        return False
    if any(seg.startswith(".") for seg in p.parts[:-1]):
        return False
    return True


def iter_source_files(root: Path) -> Iterable[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in SOURCE_EXTS:
                yield p


# ---- tree-sitter extraction -------------------------------------------------

_PARSERS: dict[str, object] = {}


def _get_parser(lang: str):
    if lang in _PARSERS:
        return _PARSERS[lang]
    import tree_sitter as ts
    from tree_sitter_language_pack import get_language
    parser = ts.Parser(get_language(lang))
    _PARSERS[lang] = parser
    return parser


def extract_ts_specifiers(source: bytes, lang: str) -> list[str]:
    parser = _get_parser(lang)
    tree = parser.parse(source)
    specs: list[str] = []

    def str_child(node) -> Optional[str]:
        for c in node.children:
            if c.type in ("string", "string_fragment"):
                raw = source[c.start_byte:c.end_byte].decode("utf-8", "replace")
                return raw.strip().strip('"').strip("'").strip("`")
        return None

    def walk(n):
        t = n.type
        if t in ("import_statement", "export_statement"):
            s = str_child(n)
            if s:
                specs.append(s)
        elif t == "call_expression":
            fn = n.child_by_field_name("function")
            if fn is not None:
                fname = source[fn.start_byte:fn.end_byte]
                if fname in (b"require", b"import"):
                    args = n.child_by_field_name("arguments")
                    if args is not None:
                        for c in args.children:
                            if c.type == "string":
                                v = source[c.start_byte:c.end_byte].decode("utf-8", "replace")
                                specs.append(v.strip().strip('"').strip("'").strip("`"))
        for c in n.children:
            walk(c)

    walk(tree.root_node)
    return specs


def extract_py_imports(source: bytes) -> list[tuple[str, int]]:
    parser = _get_parser("python")
    tree = parser.parse(source)
    out: list[tuple[str, int]] = []

    def walk(n):
        if n.type == "import_from_statement":
            mod = n.child_by_field_name("module_name")
            if mod is not None:
                raw = source[mod.start_byte:mod.end_byte].decode("utf-8", "replace").strip()
                dots = len(raw) - len(raw.lstrip("."))
                out.append((raw, dots))
            else:
                txt = source[n.start_byte:n.end_byte].decode("utf-8", "replace")
                lead = txt.split("import", 1)[0].replace("from", "").strip()
                dots = len(lead) - len(lead.lstrip("."))
                if dots:
                    out.append((lead, dots))
        elif n.type == "import_statement":
            for c in n.children:
                if c.type == "dotted_name":
                    raw = source[c.start_byte:c.end_byte].decode("utf-8", "replace").strip()
                    out.append((raw, 0))
                elif c.type == "aliased_import":
                    dn = c.child_by_field_name("name")
                    if dn is not None:
                        raw = source[dn.start_byte:dn.end_byte].decode("utf-8", "replace").strip()
                        out.append((raw, 0))
        for c in n.children:
            walk(c)

    walk(tree.root_node)
    return out


# ---- specifier resolution ---------------------------------------------------

def resolve_ts(spec: str, importer_rel: str, all_files: set[str]) -> Optional[str]:
    if not spec:
        return None
    if spec.startswith("@/"):
        base = spec[2:]
    elif spec.startswith("./") or spec.startswith("../") or spec == "." or spec == "..":
        base = _posix_join(_posix_dir(importer_rel), spec)
    elif spec.startswith("/"):
        base = spec.lstrip("/")
    else:
        return None

    base = _normalize(base)
    if base is None:
        return None
    if base in all_files:
        return base
    for suf in TS_RESOLVE_SUFFIXES:
        cand = base + suf
        if cand in all_files:
            return cand
    return None


def resolve_py(raw: str, dots: int, importer_rel: str, all_files: set[str]) -> Optional[str]:
    importer_dir = _posix_dir(importer_rel)
    if dots:
        parts = importer_dir.split("/") if importer_dir else []
        climb = dots - 1
        if climb > len(parts):
            return None
        base_dir = "/".join(parts[: len(parts) - climb]) if climb else importer_dir
        modpart = raw.lstrip(".").replace(".", "/")
        base = _posix_join(base_dir, modpart) if modpart else base_dir
    else:
        base = raw.replace(".", "/")
    base = _normalize(base)
    if base is None:
        return None
    for cand in (base + ".py", base + "/__init__.py"):
        if cand in all_files:
            return cand
    return None


def _posix_dir(p: str) -> str:
    return p.rsplit("/", 1)[0] if "/" in p else ""


def _posix_join(a: str, b: str) -> str:
    if not a:
        return b
    return f"{a.rstrip('/')}/{b}"


def _normalize(p: str) -> Optional[str]:
    parts: list[str] = []
    for seg in p.replace("\\", "/").split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if not parts:
                return None
            parts.pop()
        else:
            parts.append(seg)
    return "/".join(parts)


# ---- analysis ---------------------------------------------------------------

class FileInfo:
    __slots__ = ("path", "language", "imports", "sha")

    def __init__(self, path: str, language: str):
        self.path = path
        self.language = language
        self.imports: set[str] = set()  # resolved repo-relative targets
        self.sha: str = ""


def _resolve_imports_for(rel: str, lang: str, src: bytes, all_rel: set[str]) -> set[str]:
    out: set[str] = set()
    if lang == "python":
        for raw, dots in extract_py_imports(src):
            tgt = resolve_py(raw, dots, rel, all_rel)
            if tgt and tgt != rel:
                out.add(tgt)
    else:
        for spec in extract_ts_specifiers(src, lang):
            tgt = resolve_ts(spec, rel, all_rel)
            if tgt and tgt != rel:
                out.add(tgt)
    return out


def analyze_repo(root: Path) -> dict[str, FileInfo]:
    """Walk the repo, parse every source file, resolve imports + record content
    hash. Returns {repo_rel_path: FileInfo}."""
    root = root.resolve()
    files: list[tuple[Path, str, str]] = []
    for abs_path in iter_source_files(root):
        lang = lang_for(abs_path)
        if not lang:
            continue
        rel = abs_path.resolve().relative_to(root).as_posix()
        files.append((abs_path, rel, lang))

    all_rel = {rel for _, rel, _ in files}
    infos: dict[str, FileInfo] = {}

    for abs_path, rel, lang in files:
        info = FileInfo(rel, lang)
        try:
            src = abs_path.read_bytes()
        except Exception:
            infos[rel] = info
            continue
        info.sha = hashlib.sha1(src).hexdigest()
        try:
            info.imports = _resolve_imports_for(rel, lang, src, all_rel)
        except Exception as e:
            print(f"[code-analyzer] parse error {rel}: {e}", file=sys.stderr)
        infos[rel] = info

    return infos


def analyze_one_file(root: Path, rel: str, all_rel: set[str]) -> Optional[FileInfo]:
    """Parse a SINGLE repo-relative file. all_rel = set of all current repo
    source paths (for import resolution). Returns FileInfo or None if missing."""
    lang = lang_for(Path(rel))
    if not lang:
        return None
    abs_path = (root / rel)
    if not abs_path.is_file():
        return None
    info = FileInfo(rel, lang)
    try:
        src = abs_path.read_bytes()
    except Exception:
        return info
    info.sha = hashlib.sha1(src).hexdigest()
    try:
        info.imports = _resolve_imports_for(rel, lang, src, all_rel)
    except Exception as e:
        print(f"[code-analyzer] parse error {rel}: {e}", file=sys.stderr)
    return info


# ---- Kuzu persistence -------------------------------------------------------

DDL = [
    ("File",
     "CREATE NODE TABLE IF NOT EXISTS File("
     "id STRING, repo STRING, path STRING, language STRING, symbol_count INT64, "
     "PRIMARY KEY (id))"),
    ("IMPORTS", "CREATE REL TABLE IF NOT EXISTS IMPORTS(FROM File TO File)"),
    ("CALLS", "CREATE REL TABLE IF NOT EXISTS CALLS(FROM File TO File)"),
]


def _fid(repo: str, path: str) -> str:
    return f"{repo}::{path}"


def ensure_schema(conn) -> None:
    """Create the code-graph tables if absent. Does NOT drop anything."""
    for _name, ddl in DDL:
        conn.execute(ddl)


def drop_and_recreate_schema(conn) -> None:
    """Full-rebuild only: DROP the code-graph tables and recreate them fresh."""
    for tbl in ("IMPORTS", "CALLS"):
        try:
            conn.execute(f"DROP TABLE {tbl}")
        except Exception:
            pass
    try:
        conn.execute("DROP TABLE File")
    except Exception:
        pass
    for _name, ddl in DDL:
        conn.execute(ddl)


def _insert_file_node(conn, repo: str, info: FileInfo) -> None:
    conn.execute(
        "CREATE (f:File {id: $id, repo: $repo, path: $path, language: $lang, symbol_count: 0})",
        {"id": _fid(repo, info.path), "repo": repo, "path": info.path, "lang": info.language},
    )


def _node_exists(conn, repo: str, rel: str) -> bool:
    res = conn.execute("MATCH (f:File {id: $id}) RETURN count(f)", {"id": _fid(repo, rel)})
    return res.has_next() and (res.get_next()[0] or 0) > 0


def _ensure_node(conn, repo: str, info: FileInfo) -> None:
    """Create the File node only if it doesn't already exist. Used by the
    incremental path so a modified file keeps its identity (and its INCOMING
    edges from unchanged importers) instead of being dropped + recreated."""
    if not _node_exists(conn, repo, info.path):
        _insert_file_node(conn, repo, info)


def _delete_out_edges(conn, repo: str, rel: str) -> None:
    """Delete ONLY the outgoing IMPORTS/CALLS edges of a file. Incoming edges
    (from other, unchanged files) are preserved — they don't change just
    because this file's imports did."""
    fid = _fid(repo, rel)
    conn.execute("MATCH (a:File {id: $id})-[e:IMPORTS]->() DELETE e", {"id": fid})
    conn.execute("MATCH (a:File {id: $id})-[e:CALLS]->() DELETE e", {"id": fid})


def _insert_edges_for(conn, repo: str, info: FileInfo, present_targets: set[str]) -> int:
    """Insert IMPORTS edges for one file. Only edges to targets that currently
    exist as File nodes (present_targets) are created."""
    n = 0
    for tgt in info.imports:
        if tgt not in present_targets:
            continue
        conn.execute(
            "MATCH (a:File {id: $src}), (b:File {id: $dst}) CREATE (a)-[:IMPORTS]->(b)",
            {"src": _fid(repo, info.path), "dst": _fid(repo, tgt)},
        )
        n += 1
    return n


def _delete_file(conn, repo: str, rel: str) -> None:
    """Delete a File node and ALL its edges (in + out) for a repo-relative path.
    Incoming edges from other files are deleted too — they get re-created when
    those importer files are themselves re-parsed; for a genuinely deleted
    target they correctly disappear."""
    fid = _fid(repo, rel)
    conn.execute("MATCH (a:File {id: $id})-[e:IMPORTS]->() DELETE e", {"id": fid})
    conn.execute("MATCH ()-[e:IMPORTS]->(b:File {id: $id}) DELETE e", {"id": fid})
    conn.execute("MATCH (a:File {id: $id})-[e:CALLS]->() DELETE e", {"id": fid})
    conn.execute("MATCH ()-[e:CALLS]->(b:File {id: $id}) DELETE e", {"id": fid})
    conn.execute("MATCH (f:File {id: $id}) DELETE f", {"id": fid})


def _repo_paths(conn, repo: str) -> set[str]:
    res = conn.execute("MATCH (f:File {repo: $repo}) RETURN f.path", {"repo": repo})
    out: set[str] = set()
    while res.has_next():
        row = res.get_next()
        if row and isinstance(row[0], str):
            out.add(row[0])
    return out


def insert_repo(conn, repo: str, infos: dict[str, FileInfo]) -> dict:
    """Bulk insert one repo's nodes + edges into freshly-created tables."""
    for rel, info in infos.items():
        _insert_file_node(conn, repo, info)
    present = set(infos.keys())
    edge_count = 0
    for rel, info in infos.items():
        edge_count += _insert_edges_for(conn, repo, info, present)
    return {"files": len(infos), "imports": edge_count}


# ---- state (per-repo last commit + per-file hash) --------------------------

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
        print(f"[code-analyzer] state save warn: {e}", file=sys.stderr)


# ---- git helpers ------------------------------------------------------------

def _git(root: Path, *args: str, timeout: int = 60) -> str:
    res = subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True, text=True, timeout=timeout,
    )
    if res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {res.stderr.strip()[:200]}")
    return res.stdout


def _head_commit(root: Path) -> str:
    return _git(root, "rev-parse", "HEAD").strip()


def git_diff_name_status(root: Path, base: str, head: str = "HEAD") -> list[tuple[str, str]]:
    """Return [(status, path)] for changed files base..head. Renames split into
    delete-old + add-new."""
    out = _git(root, "diff", "--name-status", "-M", base, head)
    changes: list[tuple[str, str]] = []
    for line in out.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        st = parts[0]
        if st.startswith("R") and len(parts) >= 3:
            changes.append(("D", parts[1]))
            changes.append(("A", parts[2]))
        elif len(parts) >= 2:
            changes.append((st[0], parts[1]))
    return changes


# ---- clone / source resolution ---------------------------------------------

def shallow_clone(repo: str, dest: Path, branch: str = "main") -> None:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    auth = f"x-access-token:{token}@" if token else ""
    url = f"https://{auth}github.com/{repo}.git"
    subprocess.run(
        ["git", "clone", "--depth", "1", url, str(dest)],
        check=True, capture_output=True, text=True, timeout=180,
    )


def clone_for_diff(repo: str, dest: Path, branch: str, base: Optional[str]) -> None:
    """Clone enough history to diff base..HEAD. With a known base we do a
    blobless full-history clone (cheap); otherwise shallow (caller full-parses)."""
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    auth = f"x-access-token:{token}@" if token else ""
    url = f"https://{auth}github.com/{repo}.git"
    if base:
        subprocess.run(
            ["git", "clone", "--filter=blob:none", url, str(dest)],
            check=True, capture_output=True, text=True, timeout=300,
        )
        try:
            subprocess.run(["git", "-C", str(dest), "fetch", "--depth", "1000", "origin", base],
                           capture_output=True, text=True, timeout=180)
        except Exception:
            pass
    else:
        subprocess.run(
            ["git", "clone", "--depth", "1", url, str(dest)],
            check=True, capture_output=True, text=True, timeout=180,
        )


# ---- FULL REBUILD path (baseline / recovery only) ---------------------------

def _analyze_source(repo: str, root: Optional[str], clone: bool, branch: str
                    ) -> tuple[dict[str, FileInfo], Optional[str]]:
    if clone or not root:
        with tempfile.TemporaryDirectory(prefix="tars-code-") as td:
            dest = Path(td) / "repo"
            shallow_clone(repo, dest, branch)
            infos = analyze_repo(dest)
            try:
                head = _head_commit(dest)
            except Exception:
                head = None
            return infos, head
    r = Path(root)
    infos = analyze_repo(r)
    try:
        head = _head_commit(r)
    except Exception:
        head = None
    return infos, head


def rebuild_many(repos: list[str], db_path: str, clone: bool, branch: str,
                 roots: Optional[dict[str, str]] = None) -> dict:
    """FULL rebuild: DROP + recreate tables, re-parse every repo. Baseline /
    recovery ONLY — not the per-update path."""
    import kuzu
    started = time.time()
    roots = roots or {}
    state = _load_state()

    analyzed: dict[str, dict[str, FileInfo]] = {}
    heads: dict[str, Optional[str]] = {}
    for repo in repos:
        try:
            infos, head = _analyze_source(repo, roots.get(repo), clone, branch)
            analyzed[repo] = infos
            heads[repo] = head
        except Exception as e:  # noqa: BLE001
            print(f"[code-analyzer] analyze failed {repo}: {e}", file=sys.stderr)

    db = kuzu.Database(db_path)
    conn = kuzu.Connection(db)
    drop_and_recreate_schema(conn)
    per_repo = {}
    for repo, infos in analyzed.items():
        per_repo[repo] = insert_repo(conn, repo, infos)
        state[repo] = {
            "commit": heads.get(repo),
            "files": {rel: info.sha for rel, info in infos.items()},
        }
    try:
        conn.execute("CHECKPOINT")
    except Exception:
        pass
    conn.close()
    db.close()
    _save_state(state)

    total_files = sum(s["files"] for s in per_repo.values())
    total_imports = sum(s["imports"] for s in per_repo.values())
    return {
        "mode": "rebuild",
        "repos": per_repo,
        "files": total_files,
        "imports": total_imports,
        "elapsed_s": round(time.time() - started, 1),
    }


# ---- INCREMENTAL UPDATE path (default per-PR/push path) ---------------------

def _compute_changed(repo: str, root: Path, state: dict,
                     explicit_files: Optional[list[str]]) -> tuple[list[tuple[str, str]], str, bool]:
    """Return (changes, head_commit, need_full)."""
    head = _head_commit(root)
    if explicit_files is not None:
        changes = []
        for rel in explicit_files:
            if not is_source_rel(rel):
                continue
            st = "M" if (root / rel).is_file() else "D"
            changes.append((st, rel))
        return changes, head, False

    repo_state = state.get(repo) or {}
    base = repo_state.get("commit")
    if not base:
        return [], head, True
    if base == head:
        return [], head, False
    try:
        changes = git_diff_name_status(root, base, "HEAD")
    except Exception as e:
        print(f"[code-analyzer] diff failed {repo} ({base}..HEAD): {e}; full parse",
              file=sys.stderr)
        return [], head, True
    changes = [(st, rel) for st, rel in changes if is_source_rel(rel)]
    return changes, head, False


def update_one_repo(conn, repo: str, root: Path, changes: list[tuple[str, str]],
                    state: dict) -> dict:
    """Apply an incremental update for ONE repo. Mutates state[repo] in place."""
    repo_state = state.setdefault(repo, {"commit": None, "files": {}})
    file_hashes: dict[str, str] = dict(repo_state.get("files", {}))

    all_rel = {p.resolve().relative_to(root.resolve()).as_posix()
               for p in iter_source_files(root)}

    added = modified = removed = skipped = edges = 0
    new_nodes: list[FileInfo] = []  # added files — need a 2nd pass to wire incoming edges
    for st, rel in changes:
        if st == "D":
            # genuine delete: drop the node + ALL its edges (in + out). Incoming
            # edges from importers correctly disappear (the target is gone).
            _delete_file(conn, repo, rel)
            file_hashes.pop(rel, None)
            removed += 1
            continue
        info = analyze_one_file(root, rel, all_rel)
        if info is None:
            # vanished between diff and parse -> treat as delete
            _delete_file(conn, repo, rel)
            file_hashes.pop(rel, None)
            removed += 1
            continue
        if file_hashes.get(rel) == info.sha and _node_exists(conn, repo, rel):
            skipped += 1
            continue
        existed = rel in file_hashes
        # MODIFIED/ADDED: keep (or create) the node so its INCOMING edges from
        # unchanged importers survive; replace ONLY its OUTGOING edges.
        _ensure_node(conn, repo, info)
        _delete_out_edges(conn, repo, rel)
        present = _repo_paths(conn, repo)
        edges += _insert_edges_for(conn, repo, info, present)
        file_hashes[rel] = info.sha
        if existed:
            modified += 1
        else:
            added += 1
            new_nodes.append(info)

    # 2nd pass: a brand-new file may be imported by OTHER changed files we just
    # processed before the new node existed (so their edge was skipped). Re-wire
    # incoming edges to each new node from the files in THIS changeset.
    if new_nodes:
        present = _repo_paths(conn, repo)
        new_paths = {n.path for n in new_nodes}
        for st, rel in changes:
            if st == "D" or rel in new_paths:
                continue
            info = analyze_one_file(root, rel, all_rel)
            if info is None:
                continue
            wants = info.imports & new_paths
            for tgt in wants:
                if tgt not in present:
                    continue
                # avoid duplicating an edge we may already have created
                chk = conn.execute(
                    "MATCH (a:File {id:$s})-[:IMPORTS]->(b:File {id:$d}) RETURN count(*)",
                    {"s": _fid(repo, rel), "d": _fid(repo, tgt)},
                )
                if chk.has_next() and (chk.get_next()[0] or 0) > 0:
                    continue
                conn.execute(
                    "MATCH (a:File {id:$s}),(b:File {id:$d}) CREATE (a)-[:IMPORTS]->(b)",
                    {"s": _fid(repo, rel), "d": _fid(repo, tgt)},
                )
                edges += 1

    repo_state["files"] = file_hashes
    return {"added": added, "modified": modified, "removed": removed,
            "skipped": skipped, "edges_added": edges, "changed": len(changes)}


def update_many(repos: list[str], db_path: str, clone: bool, branch: str,
                roots: Optional[dict[str, str]] = None,
                explicit_files: Optional[dict[str, list[str]]] = None) -> dict:
    """Incremental update across repos. A repo with no baseline is full-parsed
    once (recorded), then subsequent runs are incremental."""
    import kuzu
    started = time.time()
    roots = roots or {}
    explicit_files = explicit_files or {}
    state = _load_state()

    prepared: dict[str, dict] = {}
    full_needed: dict[str, dict[str, FileInfo]] = {}
    tmpdirs: list[tempfile.TemporaryDirectory] = []
    for repo in repos:
        try:
            local_root = roots.get(repo)
            if clone or not local_root:
                base = (state.get(repo) or {}).get("commit")
                td = tempfile.TemporaryDirectory(prefix="tars-code-")
                tmpdirs.append(td)
                dest = Path(td.name) / "repo"
                clone_for_diff(repo, dest, branch, base)
                root = dest
            else:
                root = Path(local_root)
            changes, head, need_full = _compute_changed(
                repo, root, state, explicit_files.get(repo)
            )
            if need_full:
                full_needed[repo] = analyze_repo(root)
                prepared[repo] = {"root": root, "head": head, "full": True}
            else:
                prepared[repo] = {"root": root, "head": head, "changes": changes, "full": False}
        except Exception as e:  # noqa: BLE001
            print(f"[code-analyzer] prepare failed {repo}: {e}", file=sys.stderr)

    db = kuzu.Database(db_path)
    conn = kuzu.Connection(db)
    ensure_schema(conn)
    per_repo = {}
    for repo, prep in prepared.items():
        try:
            if prep.get("full"):
                infos = full_needed[repo]
                for rel in _repo_paths(conn, repo):
                    _delete_file(conn, repo, rel)
                stats = insert_repo(conn, repo, infos)
                state[repo] = {
                    "commit": prep["head"],
                    "files": {rel: info.sha for rel, info in infos.items()},
                }
                per_repo[repo] = {"mode": "baseline", **stats}
            else:
                stats = update_one_repo(conn, repo, prep["root"], prep["changes"], state)
                state[repo]["commit"] = prep["head"]
                per_repo[repo] = {"mode": "incremental", **stats}
        except Exception as e:  # noqa: BLE001
            print(f"[code-analyzer] update failed {repo}: {e}", file=sys.stderr)
            per_repo[repo] = {"mode": "error", "error": str(e)}
    try:
        conn.execute("CHECKPOINT")
    except Exception:
        pass
    conn.close()
    db.close()
    _save_state(state)
    for td in tmpdirs:
        try:
            td.cleanup()
        except Exception:
            pass

    return {
        "mode": "update",
        "repos": per_repo,
        "elapsed_s": round(time.time() - started, 1),
    }


# ---- CLI --------------------------------------------------------------------

def _parse_repos(args) -> list[str]:
    if args.repos:
        return [r.strip() for r in args.repos.split(",") if r.strip()]
    if args.repo:
        return [args.repo]
    return []


def main() -> None:
    ap = argparse.ArgumentParser(description="TARS code-graph analyzer (incremental)")
    ap.add_argument("command", nargs="?", default="update",
                    choices=["update", "rebuild"],
                    help="update = incremental (default); rebuild = full DROP+reparse")
    ap.add_argument("--repo", help="single owner/repo")
    ap.add_argument("--repos", help="comma-separated owner/repo list")
    ap.add_argument("--root", default=None, help="local checkout path (single-repo)")
    ap.add_argument("--files", default=None,
                    help="comma-separated changed-file list (single-repo update; "
                         "skips git diff — used by the webhook path)")
    ap.add_argument("--clone", action="store_true", help="clone via GH_TOKEN")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--db", default=DEFAULT_DB_PATH)
    args = ap.parse_args()

    repos = _parse_repos(args)
    if not repos:
        ap.error("one of --repo or --repos is required")

    roots = {args.repo: args.root} if (args.repo and args.root) else None
    explicit = None
    if args.files is not None and args.repo:
        explicit = {args.repo: [f.strip() for f in args.files.split(",") if f.strip()]}

    if args.command == "rebuild":
        stats = rebuild_many(repos, args.db, args.clone or not args.root, args.branch,
                             roots=roots)
    else:
        stats = update_many(repos, args.db, args.clone or not args.root, args.branch,
                            roots=roots, explicit_files=explicit)
    print(f"[code-analyzer] {stats}", flush=True)


if __name__ == "__main__":
    main()
