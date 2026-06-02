"""
TARS AWS read-only discovery worker.

INCREMENTAL by design (see memory `graph-updates-must-be-incremental`): each run
lists the CURRENT tagged-resource set (per region) + current-period cost-by-service
and reconciles the graph (adds new, removes vanished). The graph IS the state —
no separate state file. New resources get their account/repo edges; existing ones
only have properties refreshed (so edges are never duplicated); vanished ones are
deleted with their edges.

READ-ONLY: uses the dedicated `tars-readonly` IAM creds (ReadOnlyAccess managed
policy). Never writes to AWS. Scope = whatever the creds can see — currently
account 140138661997 (dev + staging SST stages). Prod (156460612806) is a
separate account; cross-account read is not yet wired (see task #123) so it is
simply absent here, not faked.

STORAGE: the dedicated code-graph.kuzu (same DB as File / IMPORTS / Doc) so AWS
infra links deterministically to code — an AwsResource tagged `sst:app=<x>` links
to the mapped repo (DocRepo). No OpenAI / embeddings — deterministic facts only.

  Node  AwsAccount(id, account_id, alias, ingested_at)                  PK id (=aws::<acct>)
  Node  AwsResource(id, arn, service, restype, region, stage, app,
                    name, ingested_at)                                  PK id (=arn)
  Node  AwsCost(id, account_id, service, amount, currency,
                period_start, period_end, ingested_at)                  PK id
  Rel   RESOURCE_IN_ACCOUNT(AwsResource -> AwsAccount)
  Rel   RESOURCE_FOR_REPO(AwsResource -> DocRepo)     via the sst:app tag

Env:
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION   (required)
  TARS_AWS_REGIONS      comma list of regions to scan (default eu-west-1,us-east-1)
  TARS_AWS_APP_REPOS    "app=owner/repo,..." map sst:app -> repo
                        (default reflex-connect=Apextech-Dev/reflex-connect-v2)
  TARS_CODE_GRAPH_PATH  default /data/code-graph.kuzu

Run:  python3 -m tars_graph.aws_discovery   (skips cleanly if AWS creds absent)
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta

DEFAULT_DB_PATH = os.environ.get("TARS_CODE_GRAPH_PATH", "/data/code-graph.kuzu")
REGIONS = [r.strip() for r in os.environ.get(
    "TARS_AWS_REGIONS", "eu-west-1,us-east-1").split(",") if r.strip()]

DDL = [
    ("AwsAccount",
     "CREATE NODE TABLE IF NOT EXISTS AwsAccount("
     "id STRING, account_id STRING, alias STRING, ingested_at STRING, "
     "PRIMARY KEY (id))"),
    ("AwsResource",
     "CREATE NODE TABLE IF NOT EXISTS AwsResource("
     "id STRING, arn STRING, service STRING, restype STRING, region STRING, "
     "stage STRING, app STRING, name STRING, ingested_at STRING, "
     "PRIMARY KEY (id))"),
    ("AwsCost",
     "CREATE NODE TABLE IF NOT EXISTS AwsCost("
     "id STRING, account_id STRING, service STRING, amount DOUBLE, "
     "currency STRING, period_start STRING, period_end STRING, "
     "ingested_at STRING, PRIMARY KEY (id))"),
    ("RESOURCE_IN_ACCOUNT",
     "CREATE REL TABLE IF NOT EXISTS RESOURCE_IN_ACCOUNT(FROM AwsResource TO AwsAccount)"),
    ("RESOURCE_FOR_REPO",
     "CREATE REL TABLE IF NOT EXISTS RESOURCE_FOR_REPO(FROM AwsResource TO DocRepo)"),
]


def ensure_schema(conn) -> None:
    # DocRepo is the FK target for RESOURCE_FOR_REPO; ensure it exists even if
    # Notion ingestion has never run (idempotent — identical DDL to notion).
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS DocRepo("
        "id STRING, full_name STRING, url STRING, PRIMARY KEY (id))")
    for _name, ddl in DDL:
        conn.execute(ddl)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _app_repo_map() -> dict:
    raw = os.environ.get(
        "TARS_AWS_APP_REPOS", "reflex-connect=Apextech-Dev/reflex-connect-v2")
    out: dict = {}
    for pair in raw.split(","):
        if "=" in pair:
            k, v = pair.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _arn_parts(arn: str) -> tuple[str, str, str, str]:
    """arn:partition:service:region:account:resourcetype/id (or :id)."""
    p = arn.split(":", 5)
    service = p[2] if len(p) > 2 else ""
    region = p[3] if len(p) > 3 else ""
    rest = p[5] if len(p) > 5 else ""
    restype = rest.split("/", 1)[0].split(":", 1)[0] if rest else ""
    return service, region, restype


# ---- AWS reads (boto3) ------------------------------------------------------

def discover_resources(regions: list[str]) -> dict:
    """arn -> {'tags': {...}, 'region': r}  across all scanned regions."""
    import boto3
    out: dict = {}
    for region in regions:
        client = boto3.client("resourcegroupstaggingapi", region_name=region)
        token = None
        while True:
            kw = {"ResourcesPerPage": 100}
            if token:
                kw["PaginationToken"] = token
            resp = client.get_resources(**kw)
            for m in resp.get("ResourceTagMappingList", []):
                arn = m["ResourceARN"]
                tags = {t["Key"]: t["Value"] for t in m.get("Tags", [])}
                out[arn] = {"tags": tags, "region": region}
            token = resp.get("PaginationToken") or ""
            if not token:
                break
    return out


def cost_by_service() -> list[dict]:
    """Month-to-date cost by service (UnblendedCost). On the 1st of the month,
    falls back to the previous full month so there is always a result."""
    import boto3
    ce = boto3.client("ce", region_name="us-east-1")
    now = datetime.now(timezone.utc)
    first = now.replace(day=1)
    if now.day == 1:
        prev_last = first - timedelta(days=1)
        start = prev_last.replace(day=1).strftime("%Y-%m-%d")
        end = first.strftime("%Y-%m-%d")
    else:
        start = first.strftime("%Y-%m-%d")
        end = now.strftime("%Y-%m-%d")
    resp = ce.get_cost_and_usage(
        TimePeriod={"Start": start, "End": end},
        Granularity="MONTHLY", Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
    )
    rows: list[dict] = []
    for rbt in resp.get("ResultsByTime", []):
        ps = rbt["TimePeriod"]["Start"]
        pe = rbt["TimePeriod"]["End"]
        for g in rbt.get("Groups", []):
            metric = g["Metrics"]["UnblendedCost"]
            rows.append({
                "service": g["Keys"][0],
                "amount": float(metric.get("Amount", "0") or 0),
                "currency": metric.get("Unit", "USD"),
                "start": ps, "end": pe,
            })
    return rows


# ---- graph writes (deterministic) ------------------------------------------

def _delete_resource(conn, rid: str) -> None:
    for rel in ("RESOURCE_IN_ACCOUNT", "RESOURCE_FOR_REPO"):
        conn.execute(
            f"MATCH (r:AwsResource {{id:$id}})-[e:{rel}]->() DELETE e", {"id": rid})
    conn.execute("MATCH (r:AwsResource {id:$id}) DELETE r", {"id": rid})


def _upsert_account(conn, account_id: str, alias: str, ts: str) -> str:
    aid = f"aws::{account_id}"
    ex = conn.execute("MATCH (a:AwsAccount {id:$id}) RETURN count(a)", {"id": aid})
    if ex.has_next() and (ex.get_next()[0] or 0) > 0:
        conn.execute("MATCH (a:AwsAccount {id:$id}) SET a.alias=$al, a.ingested_at=$ts",
                     {"id": aid, "al": alias, "ts": ts})
    else:
        conn.execute(
            "CREATE (a:AwsAccount {id:$id, account_id:$acc, alias:$al, ingested_at:$ts})",
            {"id": aid, "acc": account_id, "al": alias, "ts": ts})
    return aid


def _upsert_resource(conn, rec: dict, exists: bool) -> None:
    if exists:
        conn.execute(
            "MATCH (r:AwsResource {id:$id}) SET r.service=$service, r.restype=$restype, "
            "r.region=$region, r.stage=$stage, r.app=$app, r.name=$name, r.ingested_at=$ts",
            rec)
    else:
        conn.execute(
            "CREATE (r:AwsResource {id:$id, arn:$arn, service:$service, restype:$restype, "
            "region:$region, stage:$stage, app:$app, name:$name, ingested_at:$ts})", rec)


def _merge_docrepo(conn, full_name: str) -> None:
    ex = conn.execute("MATCH (r:DocRepo {id:$id}) RETURN count(r)", {"id": full_name})
    if ex.has_next() and (ex.get_next()[0] or 0) > 0:
        return
    conn.execute("CREATE (r:DocRepo {id:$id, full_name:$fn, url:$u})",
                 {"id": full_name, "fn": full_name, "u": f"https://github.com/{full_name}"})


def _link_account(conn, rid: str, aid: str) -> None:
    conn.execute(
        "MATCH (r:AwsResource {id:$r}), (a:AwsAccount {id:$a}) "
        "CREATE (r)-[:RESOURCE_IN_ACCOUNT]->(a)", {"r": rid, "a": aid})


def _link_repo(conn, rid: str, repo_id: str) -> None:
    conn.execute(
        "MATCH (r:AwsResource {id:$r}), (d:DocRepo {id:$d}) "
        "CREATE (r)-[:RESOURCE_FOR_REPO]->(d)", {"r": rid, "d": repo_id})


# ---- main ingest ------------------------------------------------------------

def ingest(db_path: str = DEFAULT_DB_PATH) -> dict:
    import kuzu
    started = time.time()
    ts = _now()

    import boto3
    account_id = boto3.client("sts").get_caller_identity()["Account"]
    try:
        alias = (boto3.client("iam").list_account_aliases().get("AccountAliases") or [""])[0]
    except Exception:
        alias = ""

    resources = discover_resources(REGIONS)
    try:
        costs = cost_by_service()
    except Exception as e:  # noqa: BLE001
        costs = []
        print(f"[aws] cost read warn: {e}", file=sys.stderr, flush=True)

    app_map = _app_repo_map()

    conn = db = None
    for _ in range(15):
        try:
            db = kuzu.Database(db_path)
            conn = kuzu.Connection(db)
            break
        except Exception as e:  # noqa: BLE001
            if "lock" in str(e).lower():
                time.sleep(1)
                continue
            raise
    ensure_schema(conn)
    aid = _upsert_account(conn, account_id, alias, ts)

    prior: set = set()
    r = conn.execute("MATCH (x:AwsResource) RETURN x.id")
    while r.has_next():
        prior.add(r.get_next()[0])

    current: set = set()
    new_count = 0
    repo_links = 0
    for arn, meta in resources.items():
        tags = meta["tags"]
        service, region, restype = _arn_parts(arn)
        region = region or meta["region"]
        rec = {
            "id": arn, "arn": arn, "service": service, "restype": restype,
            "region": region, "stage": tags.get("sst:stage", ""),
            "app": tags.get("sst:app", ""),
            "name": tags.get("Name", "") or tags.get("sst:component", ""),
            "ts": ts,
        }
        current.add(arn)
        is_new = arn not in prior
        _upsert_resource(conn, rec, exists=not is_new)
        if is_new:
            new_count += 1
            _link_account(conn, arn, aid)
            repo = app_map.get(rec["app"])
            if repo:
                _merge_docrepo(conn, repo)
                _link_repo(conn, arn, repo)
                repo_links += 1

    removed = prior - current
    for rid in removed:
        _delete_resource(conn, rid)

    # cost: replace this account's snapshot wholesale (cheap, current-period only)
    conn.execute("MATCH (c:AwsCost {account_id:$a}) DELETE c", {"a": account_id})
    for row in costs:
        cid = f"awscost::{account_id}::{row['start']}::{row['service']}"
        conn.execute(
            "CREATE (c:AwsCost {id:$id, account_id:$a, service:$s, amount:$amt, "
            "currency:$cur, period_start:$ps, period_end:$pe, ingested_at:$ts})",
            {"id": cid, "a": account_id, "s": row["service"], "amt": row["amount"],
             "cur": row["currency"], "ps": row["start"], "pe": row["end"], "ts": ts})

    stats = {
        "account": account_id, "alias": alias, "resources": len(current),
        "new": new_count, "removed": len(removed), "repo_links": repo_links,
        "cost_rows": len(costs), "regions": REGIONS,
        "secs": round(time.time() - started, 1),
    }
    del conn
    del db
    return stats


def main() -> None:
    if not os.environ.get("AWS_ACCESS_KEY_ID"):
        print("[aws] AWS_ACCESS_KEY_ID not set — skipping discovery", flush=True)
        return
    stats = ingest()
    print(f"[aws] {json.dumps(stats)[:800]}", flush=True)


if __name__ == "__main__":
    main()
