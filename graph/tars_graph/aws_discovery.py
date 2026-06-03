"""
TARS AWS read-only discovery worker — MULTI-ACCOUNT.

INCREMENTAL by design (see memory `graph-updates-must-be-incremental`): each run
lists the CURRENT tagged-resource set + current-period cost-by-service PER ACCOUNT
and reconciles the graph (adds new, removes vanished) scoped to that account. The
graph IS the state — no separate state file. New resources get their account/repo
edges; existing ones only refresh properties (no duplicate edges); vanished ones
are deleted with their edges.

READ-ONLY: each account is read via a dedicated `tars-readonly` IAM user
(ReadOnlyAccess). Never writes to AWS. Accounts (org o-xm11h9g5so):
  - default creds (AWS_ACCESS_KEY_ID)        -> 140138661997 Apextech (dev+staging)
  - prod creds   (AWS_PROD_ACCESS_KEY_ID)    -> 781133583483 Konverge Production
Add more accounts by adding AWS_<LABEL>_ACCESS_KEY_ID / _SECRET_ACCESS_KEY pairs
to TARS_AWS_EXTRA_LABELS.

STORAGE: dedicated code-graph.kuzu (same DB as File/IMPORTS/Doc) so AWS infra links
deterministically to code — an AwsResource tagged `sst:app=<x>` links to the mapped
repo (DocRepo). No OpenAI / embeddings — deterministic facts only.

  Node AwsAccount(id, account_id, alias, ingested_at)                       PK id (=aws::<acct>)
  Node AwsResource(id, arn, account_id, service, restype, region, stage,
                   app, name, ingested_at)                                  PK id (=arn)
  Node AwsCost(id, account_id, service, amount, currency,
               period_start, period_end, ingested_at)                       PK id
  Rel  RESOURCE_IN_ACCOUNT(AwsResource -> AwsAccount)
  Rel  RESOURCE_FOR_REPO(AwsResource -> DocRepo)   via the sst:app tag

Env:
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION   (required, acct1)
  AWS_PROD_ACCESS_KEY_ID / AWS_PROD_SECRET_ACCESS_KEY              (optional, prod)
  TARS_AWS_EXTRA_LABELS   comma list of extra creds labels (each AWS_<LABEL>_ACCESS_KEY_ID/_SECRET_ACCESS_KEY)
  TARS_AWS_REGIONS        regions to scan (default eu-west-1,us-east-1)
  TARS_AWS_APP_REPOS      "app=owner/repo,..." (default reflex-connect=Apextech-Dev/reflex-connect-v2)
  TARS_CODE_GRAPH_PATH    default /data/code-graph.kuzu

Run:  python3 -m tars_graph.aws_discovery   (skips cleanly if no AWS creds)
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

DEFAULT_DB_PATH = os.environ.get("TARS_CODE_GRAPH_PATH", "/data/code-graph.kuzu")
REGIONS = [r.strip() for r in os.environ.get(
    "TARS_AWS_REGIONS", "eu-west-1,us-east-1").split(",") if r.strip()]
DEFAULT_REGION = os.environ.get("AWS_DEFAULT_REGION", "eu-west-1")

DDL = [
    ("AwsAccount",
     "CREATE NODE TABLE IF NOT EXISTS AwsAccount("
     "id STRING, account_id STRING, alias STRING, ingested_at STRING, "
     "PRIMARY KEY (id))"),
    ("AwsResource",
     "CREATE NODE TABLE IF NOT EXISTS AwsResource("
     "id STRING, arn STRING, account_id STRING, service STRING, restype STRING, "
     "region STRING, stage STRING, app STRING, name STRING, ingested_at STRING, "
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


def _arn_parts(arn: str) -> tuple[str, str, str]:
    p = arn.split(":", 5)
    service = p[2] if len(p) > 2 else ""
    region = p[3] if len(p) > 3 else ""
    rest = p[5] if len(p) > 5 else ""
    restype = rest.split("/", 1)[0].split(":", 1)[0] if rest else ""
    return service, region, restype


def _sessions() -> list:
    """Build (label, boto3.Session) per configured account."""
    import boto3
    out = []
    if os.environ.get("AWS_ACCESS_KEY_ID"):
        out.append(("default", boto3.Session()))
    extra = [("PROD", "prod")]
    for label in os.environ.get("TARS_AWS_EXTRA_LABELS", "").split(","):
        label = label.strip()
        if label:
            extra.append((label.upper(), label.lower()))
    for envlabel, name in extra:
        ak = os.environ.get(f"AWS_{envlabel}_ACCESS_KEY_ID")
        sk = os.environ.get(f"AWS_{envlabel}_SECRET_ACCESS_KEY")
        if ak and sk:
            out.append((name, boto3.Session(
                aws_access_key_id=ak, aws_secret_access_key=sk,
                region_name=DEFAULT_REGION)))
    return out


# ---- AWS reads (per session) -----------------------------------------------

def discover_resources(session, regions: list[str]) -> dict:
    out: dict = {}
    for region in regions:
        client = session.client("resourcegroupstaggingapi", region_name=region)
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


def cost_by_service(session) -> list[dict]:
    ce = session.client("ce", region_name="us-east-1")
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
            "MATCH (r:AwsResource {id:$id}) SET r.account_id=$account_id, r.service=$service, "
            "r.restype=$restype, r.region=$region, r.stage=$stage, r.app=$app, "
            "r.name=$name, r.ingested_at=$ts", rec)
    else:
        conn.execute(
            "CREATE (r:AwsResource {id:$id, arn:$arn, account_id:$account_id, service:$service, "
            "restype:$restype, region:$region, stage:$stage, app:$app, name:$name, "
            "ingested_at:$ts})", rec)


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


def _ingest_account(conn, label: str, session, app_map: dict, ts: str) -> dict:
    account_id = session.client("sts").get_caller_identity()["Account"]
    try:
        alias = (session.client("iam").list_account_aliases()
                 .get("AccountAliases") or [""])[0]
    except Exception:
        alias = ""
    resources = discover_resources(session, REGIONS)
    try:
        costs = cost_by_service(session)
    except Exception as e:  # noqa: BLE001
        costs = []
        print(f"[aws:{label}] cost read warn: {e}", file=sys.stderr, flush=True)

    aid = _upsert_account(conn, account_id, alias, ts)

    prior: set = set()
    r = conn.execute("MATCH (x:AwsResource {account_id:$a}) RETURN x.id", {"a": account_id})
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
            "id": arn, "arn": arn, "account_id": account_id, "service": service,
            "restype": restype, "region": region, "stage": tags.get("sst:stage", ""),
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

    conn.execute("MATCH (c:AwsCost {account_id:$a}) DELETE c", {"a": account_id})
    for row in costs:
        cid = f"awscost::{account_id}::{row['start']}::{row['service']}"
        conn.execute(
            "CREATE (c:AwsCost {id:$id, account_id:$a, service:$s, amount:$amt, "
            "currency:$cur, period_start:$ps, period_end:$pe, ingested_at:$ts})",
            {"id": cid, "a": account_id, "s": row["service"], "amt": row["amount"],
             "cur": row["currency"], "ps": row["start"], "pe": row["end"], "ts": ts})

    return {"label": label, "account": account_id, "alias": alias,
            "resources": len(current), "new": new_count, "removed": len(removed),
            "repo_links": repo_links, "cost_rows": len(costs)}


def ingest(db_path: str = DEFAULT_DB_PATH) -> dict:
    import kuzu
    started = time.time()
    ts = _now()
    sessions = _sessions()
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

    per_account = []
    for label, sess in sessions:
        try:
            per_account.append(_ingest_account(conn, label, sess, app_map, ts))
        except Exception as e:  # noqa: BLE001
            print(f"[aws:{label}] account ingest failed: {e}", file=sys.stderr, flush=True)
            per_account.append({"label": label, "error": str(e)[:160]})

    del conn
    del db
    return {"accounts": per_account, "secs": round(time.time() - started, 1)}


def main() -> None:
    if not (os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROD_ACCESS_KEY_ID")):
        print("[aws] no AWS creds set — skipping discovery", flush=True)
        return
    stats = ingest()
    print(f"[aws] {json.dumps(stats)[:900]}", flush=True)


if __name__ == "__main__":
    main()
