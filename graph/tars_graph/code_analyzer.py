"""
TARS code-understanding layer — deterministic, LLM-free import-graph analyzer.

Parses a repo's source files with tree-sitter and stores a structural code
graph DIRECTLY in Kuzu, alongside (but independent of) the Graphiti tables:

  Node table  File(repo, path, language, symbol_count)       PK (repo, path)
  Rel  table  IMPORTS(File -> File)        importer -> imported  (resolved)
  Rel  table  CALLS(File -> File)          file-level call edge (best-effort)

These tables carry NO embeddings and never call OpenAI — they are pure
structured data. blast.py / server.py query them to compute the real
blast-radius (which files import/call a changed file).

Edge direction matters: IMPORTS goes importer -> imported, so the
blast-radius query `(caller)-[:IMPORTS]->(target)` returns the files that
depend on `target` (i.e. the blast radius of changing `target`).

Languages: TypeScript / TSX / JavaScript / JSX / Python.
- TS/JS: ES `import`, `export ... from`, and CommonJS `require(...)`.
  Specifiers are resolved against the repo using node/TS resolution
  (extensions + index files) and the `@/*` -> `./*` path alias.
- Python: `import a.b`, `from .rel import x`, `from pkg import y` resolved
  to in-repo module files / packages.

Usage:
  python3 -m tars_graph.code_analyzer --repo Apextech-sys/tars-app \
      --root /path/to/checkout [--db /data/graph.kuzu]

  # or clone-and-analyze from GitHub directly (uses GH_TOKEN):
  python3 -m tars_graph.code_analyzer --repo Apextech-sys/tars-app --clone

Re-runnable / incremental: for the analyzed repo it deletes that repo's
existing File rows + their edges, then re-inserts. Other repos untouched.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Iterable, Optional

DEFAULT_DB_PATH = os.environ.get("TARS_GRAPH_PATH", "/data/graph.kuzu")

# ---- file selection ---------------------------------------------------------

TS_JS_EXTS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"}
PY_EXTS = {".py"}
SOURCE_EXTS = TS_JS_EXTS | PY_EXTS

EXCLUDE_DIRS = {
    "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
    ".turbo", ".vercel", "__pycache__", ".venv", "venv", ".mypy_cache",
    ".pytest_cache", "vendor", ".cache", "public", "e2e", "tests-examples",
}

# Resolution candidate suffixes for TS/JS bare module paths
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


def iter_source_files(root: Path) -> Iterable[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        # prune excluded dirs in-place
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
    """Return raw import specifier strings from a TS/JS source buffer."""
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
    """Return (module_path, leading_dots) tuples for Python imports.

    For `from .a.b import x` -> ('.a.b', 1-ish handled by caller via dot count).
    We return the raw module string (incl. leading dots) and the dot count.
    For `import a.b.c` -> ('a.b.c', 0).
    """
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
                # `from . import x` — relative with no module name
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
    """Resolve a TS/JS import specifier to a repo-relative file path.

    importer_rel: posix repo-relative path of the importing file.
    all_files: set of all repo-relative posix source paths (for index/ext resolution).
    Returns repo-relative path or None (external/bare/unresolvable).
    """
    if not spec:
        return None
    # path alias: @/foo -> foo (tsconfig "@/*": ["./*"])
    if spec.startswith("@/"):
        base = spec[2:]
    elif spec.startswith("./") or spec.startswith("../") or spec == "." or spec == "..":
        base = _posix_join(_posix_dir(importer_rel), spec)
    elif spec.startswith("/"):
        base = spec.lstrip("/")
    else:
        # bare module (npm package) or unsupported alias -> external
        return None

    base = _normalize(base)
    if base is None:
        return None

    # exact match (spec already had extension)
    if base in all_files:
        return base
    # try resolution suffixes
    for suf in TS_RESOLVE_SUFFIXES:
        cand = base + suf
        if cand in all_files:
            return cand
    return None


def resolve_py(raw: str, dots: int, importer_rel: str, all_files: set[str]) -> Optional[str]:
    """Resolve a Python import to a repo-relative .py file path, or None."""
    importer_dir = _posix_dir(importer_rel)
    if dots:
        # relative import: climb `dots-1` directories from importer's package dir
        # `.mod` (1 dot) = sibling in same package; `..mod` (2 dots) = parent package
        parts = importer_dir.split("/") if importer_dir else []
        climb = dots - 1
        if climb > len(parts):
            return None
        base_dir = "/".join(parts[: len(parts) - climb]) if climb else importer_dir
        modpart = raw.lstrip(".").replace(".", "/")
        base = _posix_join(base_dir, modpart) if modpart else base_dir
    else:
        # absolute (in-repo) import: a.b.c -> a/b/c
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
    """Resolve ./ and ../ segments; reject paths that escape the repo root."""
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
    __slots__ = ("path", "language", "imports")

    def __init__(self, path: str, language: str):
        self.path = path
        self.language = language
        self.imports: set[str] = set()  # resolved repo-relative targets


def analyze_repo(root: Path) -> dict[str, FileInfo]:
    """Walk the repo, parse every source file, resolve imports. Returns
    {repo_rel_path: FileInfo}."""
    root = root.resolve()
    files: list[tuple[Path, str, str]] = []  # (abs, rel, lang)
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
        try:
            if lang == "python":
                for raw, dots in extract_py_imports(src):
                    tgt = resolve_py(raw, dots, rel, all_rel)
                    if tgt and tgt != rel:
                        info.imports.add(tgt)
            else:
                for spec in extract_ts_specifiers(src, lang):
                    tgt = resolve_ts(spec, rel, all_rel)
                    if tgt and tgt != rel:
                        info.imports.add(tgt)
        except Exception as e:
            print(f"[code-analyzer] parse error {rel}: {e}", file=sys.stderr)
        infos[rel] = info

    return infos


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
    """Composite primary key for a File node (Kuzu has no composite PKs)."""
    return f"{repo}::{path}"


def rebuild_schema(conn) -> None:
    """Full rebuild: DROP the code-graph tables and recreate them fresh.

    Why DROP instead of MATCH...DELETE: Kuzu 0.11.3 raises `unordered_map::at`
    when deleting node rows from a table whose statistics were checkpointed in
    a previous session/process. Dropping + recreating sidesteps that bug and
    keeps re-runs deterministic. The code graph is cheap to rebuild in full
    (a few seconds for all tracked repos), so a full rebuild per run is fine.
    DROP order: rel tables first (they depend on File), then File.
    """
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


def insert_repo(conn, repo: str, infos: dict[str, FileInfo]) -> dict:
    """Insert one repo's File nodes + IMPORTS edges into the (already created)
    code-graph tables. Assumes a fresh/rebuilt schema (no pre-existing rows
    for this repo)."""
    for rel, info in infos.items():
        conn.execute(
            "CREATE (f:File {id: $id, repo: $repo, path: $path, language: $lang, symbol_count: 0})",
            {"id": _fid(repo, rel), "repo": repo, "path": rel, "lang": info.language},
        )

    edge_count = 0
    paths = set(infos.keys())
    for rel, info in infos.items():
        for tgt in info.imports:
            if tgt not in paths:
                continue
            conn.execute(
                "MATCH (a:File {id: $src}), (b:File {id: $dst}) "
                "CREATE (a)-[:IMPORTS]->(b)",
                {"src": _fid(repo, rel), "dst": _fid(repo, tgt)},
            )
            edge_count += 1

    return {"files": len(infos), "imports": edge_count}


# ---- GitHub clone helper ----------------------------------------------------

def shallow_clone(repo: str, dest: Path, branch: str = "main") -> None:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    auth = f"x-access-token:{token}@" if token else ""
    url = f"https://{auth}github.com/{repo}.git"
    subprocess.run(
        ["git", "clone", "--depth", "1", "--branch", branch, url, str(dest)],
        check=True, capture_output=True, text=True, timeout=180,
    )


# ---- CLI --------------------------------------------------------------------

def _analyze_source(repo: str, root: Optional[str], clone: bool, branch: str) -> dict[str, FileInfo]:
    """Resolve the source for one repo (clone or local) and analyze it.
    Does NOT touch Kuzu — the heavy work happens outside the write lock."""
    if clone or not root:
        with tempfile.TemporaryDirectory(prefix="tars-code-") as td:
            dest = Path(td) / "repo"
            shallow_clone(repo, dest, branch)
            return analyze_repo(dest)
    return analyze_repo(Path(root))


def run_many(repos: list[str], db_path: str, clone: bool, branch: str,
             roots: Optional[dict[str, str]] = None) -> dict:
    """Analyze several repos and rebuild the WHOLE code graph in one short
    write transaction. The clone+parse (slow, network/CPU) happens BEFORE the
    Kuzu connection is opened, so the exclusive write lock is held only for the
    fast insert phase (sub-second per repo) — minimizing the window during
    which the read-only HTTP server can't serve blast-radius."""
    import kuzu
    started = time.time()
    roots = roots or {}

    # 1) clone + parse every repo first (no Kuzu lock held)
    analyzed: dict[str, dict[str, FileInfo]] = {}
    for repo in repos:
        try:
            analyzed[repo] = _analyze_source(repo, roots.get(repo), clone, branch)
        except Exception as e:  # noqa: BLE001
            print(f"[code-analyzer] analyze failed {repo}: {e}", file=sys.stderr)

    # 2) one short write transaction: DROP + recreate + insert all
    db = kuzu.Database(db_path)
    conn = kuzu.Connection(db)
    rebuild_schema(conn)
    per_repo = {}
    for repo, infos in analyzed.items():
        per_repo[repo] = insert_repo(conn, repo, infos)
    try:
        conn.execute("CHECKPOINT")
    except Exception:
        pass
    conn.close()
    db.close()

    total_files = sum(s["files"] for s in per_repo.values())
    total_imports = sum(s["imports"] for s in per_repo.values())
    return {
        "repos": per_repo,
        "files": total_files,
        "imports": total_imports,
        "elapsed_s": round(time.time() - started, 1),
    }


def run(repo: str, root: Optional[str], db_path: str, clone: bool, branch: str) -> dict:
    """Single-repo entry — kept for ad-hoc use. Rebuilds the whole code graph
    with just this one repo (DROP + recreate). For multi-repo population use
    run_many()."""
    roots = {repo: root} if root else None
    stats = run_many([repo], db_path, clone, branch, roots=roots)
    rs = stats["repos"].get(repo, {"files": 0, "imports": 0})
    return {"files": rs["files"], "imports": rs["imports"], "repo": repo,
            "elapsed_s": stats["elapsed_s"]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", help="single owner/repo (File.repo key)")
    ap.add_argument("--repos", help="comma-separated owner/repo list (rebuilds whole graph)")
    ap.add_argument("--root", default=None, help="local checkout path (single-repo only)")
    ap.add_argument("--clone", action="store_true", help="shallow-clone via GH_TOKEN")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--db", default=DEFAULT_DB_PATH)
    args = ap.parse_args()
    if args.repos:
        repos = [r.strip() for r in args.repos.split(",") if r.strip()]
        stats = run_many(repos, args.db, args.clone or not args.root, args.branch)
        print(f"[code-analyzer] {stats}", flush=True)
    elif args.repo:
        stats = run(args.repo, args.root, args.db, args.clone, args.branch)
        print(f"[code-analyzer] {stats}", flush=True)
    else:
        ap.error("one of --repo or --repos is required")


if __name__ == "__main__":
    main()
