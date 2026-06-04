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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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


_OPS_CACHE = {"ts": 0.0, "data": None}


def _ops_sessions():
    import os
    import boto3
    out = []
    if os.environ.get("AWS_ACCESS_KEY_ID"):
        out.append(("apextech", boto3.Session()))
    pak = os.environ.get("AWS_PROD_ACCESS_KEY_ID")
    psk = os.environ.get("AWS_PROD_SECRET_ACCESS_KEY")
    if pak and psk:
        out.append(("konverge-prod", boto3.Session(
            aws_access_key_id=pak, aws_secret_access_key=psk, region_name="eu-west-1")))
    return out


def _ops_for_session(label, sess):
    import datetime
    reg = "eu-west-1"
    res = {"label": label, "accountId": "",
           "alarms": {"OK": 0, "ALARM": 0, "INSUFFICIENT_DATA": 0, "firing": []},
           "services": [], "rds": [], "costTrend": []}
    try:
        res["accountId"] = sess.client("sts").get_caller_identity()["Account"]
    except Exception:  # noqa: BLE001
        pass
    try:
        cw = sess.client("cloudwatch", region_name=reg)
        for pg in cw.get_paginator("describe_alarms").paginate():
            for a in pg.get("MetricAlarms", []) + pg.get("CompositeAlarms", []):
                sv = a.get("StateValue", "")
                res["alarms"][sv] = res["alarms"].get(sv, 0) + 1
                if sv == "ALARM" and len(res["alarms"]["firing"]) < 50:
                    res["alarms"]["firing"].append({
                        "name": a["AlarmName"],
                        "reason": (a.get("StateReason", "") or "")[:200],
                    })
    except Exception as e:  # noqa: BLE001
        res["alarms"]["error"] = str(e)[:140]
    try:
        ecs = sess.client("ecs", region_name=reg)
        for c in ecs.list_clusters().get("clusterArns", []):
            cn = c.split("/")[-1]
            arns = []
            for x in ecs.get_paginator("list_services").paginate(cluster=c):
                arns += x.get("serviceArns", [])
            for i in range(0, len(arns), 10):
                for sv in ecs.describe_services(
                        cluster=c, services=arns[i:i + 10]).get("services", []):
                    res["services"].append({
                        "cluster": cn, "name": sv["serviceName"],
                        "running": sv["runningCount"], "desired": sv["desiredCount"],
                        "status": sv["status"],
                    })
    except Exception as e:  # noqa: BLE001
        res["servicesError"] = str(e)[:140]
    try:
        for x in sess.client("rds", region_name=reg).describe_db_instances().get("DBInstances", []):
            res["rds"].append({
                "id": x["DBInstanceIdentifier"], "status": x["DBInstanceStatus"],
                "engine": x.get("Engine", ""),
            })
    except Exception as e:  # noqa: BLE001
        res["rdsError"] = str(e)[:140]
    try:
        ce = sess.client("ce", region_name="us-east-1")
        end = datetime.date.today()
        start = end - datetime.timedelta(days=14)
        _ckw = dict(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="DAILY", Metrics=["UnblendedCost"])
        _acct = res.get("accountId")
        if _acct:
            _ckw["Filter"] = {
                "Dimensions": {"Key": "LINKED_ACCOUNT", "Values": [_acct]}}
        r = ce.get_cost_and_usage(**_ckw)
        for p in r.get("ResultsByTime", []):
            res["costTrend"].append({
                "date": p["TimePeriod"]["Start"],
                "amount": round(float(p["Total"]["UnblendedCost"]["Amount"]), 2),
            })
    except Exception as e:  # noqa: BLE001
        res["costError"] = str(e)[:140]
    return res


def aws_ops():
    """Live operational snapshot per account — alarms, ECS health, RDS, cost trend.
    60s in-memory cache (the boto3 fan-out is several seconds)."""
    import os
    import time as _t
    if not (os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROD_ACCESS_KEY_ID")):
        return {"available": False, "notes": "aws creds not set"}
    now = _t.time()
    if _OPS_CACHE["data"] is not None and now - _OPS_CACHE["ts"] < 60:
        return _OPS_CACHE["data"]
    accounts = []
    for label, sess in _ops_sessions():
        try:
            accounts.append(_ops_for_session(label, sess))
        except Exception as e:  # noqa: BLE001
            accounts.append({"label": label, "error": str(e)[:160]})
    data = {"available": True, "accounts": accounts, "notes": ""}
    _OPS_CACHE["ts"] = now
    _OPS_CACHE["data"] = data
    return data


def _temporal_run(coro_fn):
    """Connect to Temporal Cloud (API key + TLS) and run coro_fn(client).
    Returns (result, None) or (None, error_dict). New connection per call —
    fine for a low-traffic read panel."""
    import asyncio
    addr = os.environ.get("TEMPORAL_ADDRESS")
    ns = os.environ.get("TEMPORAL_NAMESPACE")
    key = os.environ.get("TEMPORAL_API_KEY")
    if not (addr and ns and key):
        return None, {"notes": "temporal creds not set"}
    try:
        from temporalio.client import Client
    except Exception as e:  # noqa: BLE001
        return None, {"notes": f"temporalio import failed: {e}"}

    async def _run():
        client = await Client.connect(addr, namespace=ns, api_key=key, tls=True)
        return await coro_fn(client)

    try:
        return asyncio.run(asyncio.wait_for(_run(), timeout=18)), None
    except Exception as e:  # noqa: BLE001
        return None, {"notes": str(e)[:240]}


def temporal_workflows() -> dict:
    """Most-recent workflow executions in the namespace (read-only)."""
    ns = os.environ.get("TEMPORAL_NAMESPACE", "")

    async def fetch(client):
        out = []
        async for w in client.list_workflows():
            out.append({
                "id": w.id, "runId": w.run_id, "type": w.workflow_type,
                "status": (w.status.name if w.status else ""),
                "start": (w.start_time.isoformat() if w.start_time else ""),
                "close": (w.close_time.isoformat() if w.close_time else ""),
            })
            if len(out) >= 75:
                break
        return out

    res, err = _temporal_run(fetch)
    if err is not None:
        return {"available": False, "workflows": [], "notes": err["notes"]}
    return {"available": True, "namespace": ns, "count": len(res),
            "workflows": res, "notes": ""}


def temporal_summary() -> dict:
    """Counts of workflow executions by status (read-only)."""
    ns = os.environ.get("TEMPORAL_NAMESPACE", "")

    async def fetch(client):
        stats = {}
        for label, q in (
            ("running", 'ExecutionStatus="Running"'),
            ("failed", 'ExecutionStatus="Failed"'),
            ("completed", 'ExecutionStatus="Completed"'),
            ("terminated", 'ExecutionStatus="Terminated"'),
            ("timedOut", 'ExecutionStatus="TimedOut"'),
            ("canceled", 'ExecutionStatus="Canceled"'),
        ):
            try:
                c = await client.count_workflows(query=q)
                stats[label] = int(c.count)
            except Exception:  # noqa: BLE001
                stats[label] = -1
        return stats

    res, err = _temporal_run(fetch)
    if err is not None:
        return {"available": False, "notes": err["notes"]}
    return {"available": True, "namespace": ns, "counts": res, "notes": ""}


def _decode_payloads(obj):
    """Recursively decode Temporal Payload {{metadata, data:<b64>}} blobs to text/JSON."""
    import base64
    import json as _json
    if isinstance(obj, dict):
        if isinstance(obj.get("data"), str) and "metadata" in obj:
            try:
                raw = base64.b64decode(obj["data"])
                txt = raw.decode("utf-8", "replace")
                try:
                    return _json.loads(txt)
                except Exception:
                    return txt[:2000]
            except Exception:
                return str(obj.get("data", ""))[:200]
        return {k: _decode_payloads(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_decode_payloads(x) for x in obj]
    return obj


def temporal_workflow_detail(wid: str, run_id: str) -> dict:
    """Full describe + event history for a single workflow execution (read-only)."""
    async def fetch(client):
        from google.protobuf.json_format import MessageToDict
        h = client.get_workflow_handle(wid, run_id=(run_id or None))
        d = await h.describe()
        info = {
            "id": d.id, "runId": d.run_id, "type": d.workflow_type,
            "status": (d.status.name if d.status else ""),
            "taskQueue": getattr(d, "task_queue", ""),
            "start": (d.start_time.isoformat() if d.start_time else ""),
            "close": (d.close_time.isoformat() if d.close_time else ""),
            "historyLength": getattr(d, "history_length", None),
        }
        pending = []
        try:
            for pa in d.raw_description.pending_activities:
                pending.append({
                    "activityId": pa.activity_id,
                    "activityType": pa.activity_type.name,
                    "state": int(pa.state), "attempt": pa.attempt,
                    "lastFailure": (pa.last_failure.message if pa.HasField("last_failure") else ""),
                })
        except Exception:  # noqa: BLE001
            pass
        events = []
        async for ev in h.fetch_history_events():
            dd = MessageToDict(ev)
            akey = [k for k in dd if k.endswith("EventAttributes")]
            attrs = _decode_payloads(dd[akey[0]]) if akey else {}
            failure = ""
            if isinstance(attrs, dict) and isinstance(attrs.get("failure"), dict):
                failure = str(attrs["failure"].get("message", ""))[:600]
            events.append({
                "id": int(dd.get("eventId", 0) or 0),
                "time": dd.get("eventTime", ""),
                "type": dd.get("eventType", "").replace("EVENT_TYPE_", ""),
                "failure": failure,
                "attrs": attrs,
            })
            if len(events) >= 400:
                break
        return {"info": info, "pending": pending, "events": events}

    res, err = _temporal_run(fetch)
    if err is not None:
        return {"available": False, "notes": err["notes"]}
    out = {"available": True, "notes": ""}
    out.update(res)
    return out


def list_aws_resources() -> dict:
    """AWS resources discovered into the code-graph (account 140138661997 scope)."""
    try:
        conn, _db = _open_ro()
    except Exception as e:
        return {"available": False, "resources": [], "notes": f"graph open soft-fail: {e}"}
    out: list[dict] = []
    try:
        res = conn.execute(
            "MATCH (x:AwsResource) RETURN x.arn, x.service, x.restype, x.region, "
            "x.stage, x.app, x.name ORDER BY x.service, x.name LIMIT 2000")
        while res.has_next():
            row = res.get_next()
            out.append({"arn": row[0], "service": row[1], "type": row[2],
                        "region": row[3], "stage": row[4], "app": row[5], "name": row[6]})
    except Exception as e:
        return {"available": True, "resources": [], "notes": f"aws not ingested yet: {e}"}
    return {"available": True, "count": len(out), "resources": out, "notes": ""}


def list_aws_accounts() -> dict:
    """AWS accounts TARS can see + resource counts per account."""
    try:
        conn, _db = _open_ro()
    except Exception as e:
        return {"available": False, "accounts": [], "notes": f"graph open soft-fail: {e}"}
    out: list[dict] = []
    try:
        res = conn.execute(
            "MATCH (a:AwsAccount) OPTIONAL MATCH (r:AwsResource)-[:RESOURCE_IN_ACCOUNT]->(a) "
            "RETURN a.account_id, a.alias, count(DISTINCT r) ORDER BY a.account_id")
        while res.has_next():
            row = res.get_next()
            out.append({"accountId": row[0], "alias": row[1], "resourceCount": row[2] or 0})
    except Exception as e:
        return {"available": True, "accounts": [], "notes": f"aws not ingested yet: {e}"}
    return {"available": True, "accounts": out, "notes": ""}


def aws_cost() -> dict:
    """Month-to-date AWS cost by service (descending) + total."""
    try:
        conn, _db = _open_ro()
    except Exception as e:
        return {"available": False, "services": [], "notes": f"graph open soft-fail: {e}"}
    agg: dict = {}
    total = 0.0
    period = {"start": "", "end": ""}
    try:
        res = conn.execute(
            "MATCH (c:AwsCost) RETURN c.service, c.amount, c.currency, c.period_start, "
            "c.period_end")
        while res.has_next():
            row = res.get_next()
            amt = float(row[1] or 0)
            agg[row[0]] = agg.get(row[0], 0.0) + amt
            total += amt
            period = {"start": row[3], "end": row[4]}
    except Exception as e:
        return {"available": True, "services": [], "notes": f"aws cost not ingested yet: {e}"}
    services = [
        {"service": k, "amount": round(v, 2), "currency": "USD"}
        for k, v in sorted(agg.items(), key=lambda kv: -kv[1])
    ]
    return {"available": True, "currency": "USD", "total": round(total, 2),
            "period": period, "services": services, "notes": ""}


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
        elif route == "/aws/resources":
            self.send_json(200, list_aws_resources())
        elif route == "/aws/accounts":
            self.send_json(200, list_aws_accounts())
        elif route == "/aws/cost":
            self.send_json(200, aws_cost())
        elif route == "/aws/ops":
            self.send_json(200, aws_ops())
        elif route == "/temporal/workflows":
            self.send_json(200, temporal_workflows())
        elif route == "/temporal/summary":
            self.send_json(200, temporal_summary())
        elif route == "/temporal/workflow":
            qs = parse_qs(parsed.query)
            wid = (qs.get("id") or [""])[0]
            rid = (qs.get("runId") or [""])[0]
            if not wid:
                self.send_json(400, {"error": "id query param required"})
                return
            self.send_json(200, temporal_workflow_detail(wid, rid))
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
    server = ThreadingHTTPServer(("0.0.0.0", PORT), GraphHandler)
    print(f"[tars-graph] Listening on 0.0.0.0:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
