#!/usr/bin/env python3
"""
Blast-radius query helper for the TARS graph.

Called from workflows/lib/graph-client.ts as:

  python3 /home/shaun/.tars-state/tars_graph/blast.py --repo OWNER/REPO --file PATH

Outputs JSON on stdout:

  {
    "callers": ["other/file.py", ...],
    "openPrs": [],
    "notes": "..."
  }

If the graph is unavailable, exits 0 with empty payload — never blocks the
workflow.

Implementation note: the TARS graph (Kuzu) is opened read-only, so concurrent
read access from the discovery worker is safe. We catch ALL exceptions and
fall through to empty output.
"""

import argparse
import json
import sys
import os

GRAPH_PATH = os.environ.get("TARS_GRAPH_PATH", "/data/graph.kuzu")


def query_callers(repo: str, file: str) -> dict:
    try:
        # Lazy-import; kuzu may not be on the venv path when called from Node.
        import kuzu  # type: ignore
    except Exception as e:
        return {"callers": [], "openPrs": [], "notes": f"kuzu not importable: {e}"}

    try:
        db = kuzu.Database(GRAPH_PATH, read_only=True)
        conn = kuzu.Connection(db)
        # Match files that reference this file via any edge. The TARS graph
        # has IMPORTS / CALLS / REFERENCES edges; we union them where present.
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
            return {"callers": paths, "openPrs": [], "notes": ""}
        except Exception as e:
            # Schema may not have File nodes yet — that's fine.
            return {
                "callers": [],
                "openPrs": [],
                "notes": f"graph query soft-fail: {e}",
            }
    except Exception as e:
        return {
            "callers": [],
            "openPrs": [],
            "notes": f"graph open soft-fail: {e}",
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--file", required=True)
    args = ap.parse_args()
    result = query_callers(args.repo, args.file)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
