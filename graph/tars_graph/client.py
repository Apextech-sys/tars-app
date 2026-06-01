"""
TarsGraph — typed client over Graphiti/Kuzu.

Two surfaces:
- Write API (used by auto-discovery workers):
    upsert_project, upsert_repo, upsert_customer, upsert_slack_channel,
    upsert_linear_team, upsert_vercel_project, upsert_supabase_project,
    upsert_service, link(...)
- Read API (used by agents — always filtered to group_id='discovered'):
    get(label, name), related_to(name), deployments_for(repo),
    slack_for(project), search(query)
"""
import os
from datetime import datetime, timezone
from typing import Any, Optional

os.environ.setdefault('GRAPHITI_TELEMETRY_ENABLED', 'false')

from graphiti_core import Graphiti
from graphiti_core.driver.kuzu_driver import KuzuDriver
from graphiti_core.nodes import EntityNode
from graphiti_core.edges import EntityEdge


DEFAULT_DB_PATH = os.environ.get('TARS_GRAPH_PATH', '/data/graph.kuzu')
DISCOVERED = 'discovered'
INFERRED = 'inferred'


# WORKAROUND for graphiti-core 0.29.1 legacy KuzuDriver bug — see phase0_proof.py.
# Idempotent: each query is IF NOT EXISTS-style for INSTALL/LOAD, or harmless re-run
# for CREATE_FTS_INDEX (Kuzu raises but we swallow).
_FTS_INIT_QUERIES = [
    'INSTALL fts;',
    'LOAD fts;',
    "CALL CREATE_FTS_INDEX('Episodic', 'episode_content', ['content', 'source', 'source_description']);",
    "CALL CREATE_FTS_INDEX('Entity', 'node_name_and_summary', ['name', 'summary']);",
    "CALL CREATE_FTS_INDEX('Community', 'community_name', ['name']);",
    "CALL CREATE_FTS_INDEX('RelatesToNode_', 'edge_name_and_fact', ['name', 'fact']);",
]


class TarsGraph:
    def __init__(self, db_path: str = DEFAULT_DB_PATH):
        self.db_path = db_path
        self.driver: KuzuDriver | None = None
        self.graphiti: Graphiti | None = None

    async def connect(self) -> 'TarsGraph':
        if not os.environ.get('OPENAI_API_KEY'):
            raise RuntimeError('OPENAI_API_KEY required (for embedder)')
        self.driver = KuzuDriver(db=self.db_path)
        self.graphiti = Graphiti(graph_driver=self.driver)
        await self.graphiti.build_indices_and_constraints()
        # FTS workaround — idempotent. Detect "already initialized" by probing for
        # the edge fulltext index; only run INSTALL/CREATE on first init.
        if not await self._fts_indices_exist():
            for q in _FTS_INIT_QUERIES:
                try:
                    await self.driver.execute_query(q)
                except Exception:
                    pass
        else:
            # On subsequent connects we still need to LOAD the FTS extension into
            # this process. INSTALL is persistent on disk; LOAD is per-session.
            try:
                await self.driver.execute_query('LOAD fts;')
            except Exception:
                pass
        return self

    async def _fts_indices_exist(self) -> bool:
        """Probe whether the edge FTS index is already created on the DB file."""
        try:
            # Use the FTS query — if the index exists this returns 0 rows for an
            # unmatchable token; if it doesn't exist Kuzu raises a Binder exception.
            await self.driver.execute_query(
                "CALL QUERY_FTS_INDEX('RelatesToNode_', 'edge_name_and_fact', "
                "'__tars_probe_never_matches__', TOP := 1) RETURN *"
            )
            return True
        except Exception:
            return False

    async def close(self) -> None:
        if self.graphiti:
            await self.graphiti.close()

    async def __aenter__(self):
        return await self.connect()

    async def __aexit__(self, *a):
        await self.close()

    # ===== INTERNAL HELPERS =====

    async def _find_node(self, label: str, name: str) -> Optional[dict]:
        rows, _, _ = await self.driver.execute_query(
            "MATCH (n:Entity) WHERE n.name = $name AND list_contains(n.labels, $label) "
            "AND n.group_id = $gid "
            "RETURN n.uuid AS uuid, n.summary AS summary, n.attributes AS attributes LIMIT 1",
            name=name, label=label, gid=DISCOVERED,
        )
        return rows[0] if rows else None

    async def _upsert_node(
        self, label: str, name: str, summary: str = '',
        attributes: Optional[dict[str, Any]] = None,
    ) -> EntityNode:
        """Upsert a node by (label, name). Returns the saved node.

        MERGE semantics for attributes: new values override existing keys,
        but keys NOT in `attributes` are preserved from the existing node.
        Empty-string values in `attributes` are treated as 'unset' and
        don't override existing values (so default-valued upserts from
        link-only callers don't clobber real data set by discovery)."""
        existing = await self._find_node(label, name)
        new_attrs = dict(attributes or {})
        if existing:
            # Merge: start with existing, overlay non-empty new values
            import json as _json
            try:
                prior = _json.loads(existing.get('attributes') or '{}')
            except Exception:
                prior = {}
            merged = dict(prior)
            for k, v in new_attrs.items():
                # Don't overwrite existing real value with empty string/None
                # (avoids the bug where bulk-link callers default to '' and
                # clobber discovery's correct values)
                if v in ('', None) and prior.get(k) not in ('', None):
                    continue
                merged[k] = v
            attrs = merged
        else:
            attrs = new_attrs
        if existing:
            node = EntityNode(
                uuid=existing['uuid'],
                name=name, group_id=DISCOVERED,
                labels=['Entity', label],
                summary=summary or existing.get('summary', ''),
                attributes=attrs,
            )
        else:
            node = EntityNode(
                name=name, group_id=DISCOVERED,
                labels=['Entity', label],
                summary=summary, attributes=attrs,
            )
        await node.generate_name_embedding(self.graphiti.embedder)
        await node.save(self.driver)
        return node

    # ===== WRITE API =====

    async def upsert_project(self, name: str, kind: str, business: str,
                              visibility: str = 'work',
                              description: str = '',
                              extra_attributes: dict | None = None) -> EntityNode:
        """visibility: 'work' (default) | 'personal'. Personal projects are
        firewalled from external posting (Linear/Slack/Notion/Teams).
        business: internal business code (freshbark|wondernet|konverge|apex|...).
        extra_attributes: merged into the Project's attributes JSON. Common keys:
          protect_mode (bool) — read-only project, all writes refused
          protect_reason (str)
          last_reviewed (ISO date)"""
        if visibility not in ('work', 'personal'):
            raise ValueError(f'visibility must be work|personal, got {visibility!r}')
        attrs = {'kind': kind, 'business': business, 'visibility': visibility}
        if extra_attributes:
            attrs.update(extra_attributes)
        return await self._upsert_node(
            'Project', name, summary=description or f'Project {name}',
            attributes=attrs,
        )

    # ===== PROTECTION ENFORCEMENT =====
    # Any write skill (commit, PR, deploy, Linear-edit, etc.) MUST call
    # assert_writable() before touching an entity. Hard-blocks on protected
    # projects (konverge etc.) without explicit Shaun-confirmed unlock.

    class Protected(RuntimeError):
        """Raised when a write is attempted against a protected project."""

    async def is_project_protected(self, project_name: str) -> tuple[bool, str]:
        """Returns (protected, reason). Reason is '' if not protected."""
        import json
        p = await self.get('Project', project_name)
        if not p:
            return False, ''
        try:
            attrs = json.loads(p.get('attributes') or '{}')
        except Exception:
            attrs = {}
        if attrs.get('protect_mode'):
            return True, attrs.get('protect_reason', 'no reason given')
        return False, ''

    async def is_repo_protected(self, repo_full_name: str) -> tuple[bool, str]:
        """A repo is protected if its OWNING project is protected."""
        rows, _, _ = await self.driver.execute_query(
            "MATCH (p:Entity)-[:RELATES_TO]->(r:RelatesToNode_)-[:RELATES_TO]->(repo:Entity) "
            "WHERE repo.name = $repo AND list_contains(repo.labels, 'Repo') "
            "AND list_contains(p.labels, 'Project') AND r.group_id = $gid "
            "AND r.name = 'OWNS' "
            "RETURN p.name AS pname, p.attributes AS attrs LIMIT 1",
            repo=repo_full_name, gid=DISCOVERED,
        )
        if not rows:
            return False, ''
        import json
        try:
            attrs = json.loads(rows[0].get('attrs') or '{}')
        except Exception:
            attrs = {}
        if attrs.get('protect_mode'):
            return True, f'owned by protected project {rows[0]["pname"]}: {attrs.get("protect_reason", "")}'
        return False, ''

    async def assert_writable(self, target: str, target_kind: str = 'project') -> None:
        """Raise Protected if writing to target is blocked.
        target_kind: 'project' | 'repo'."""
        if target_kind == 'project':
            protected, reason = await self.is_project_protected(target)
        elif target_kind == 'repo':
            protected, reason = await self.is_repo_protected(target)
        else:
            raise ValueError(f'unknown target_kind: {target_kind!r}')
        if protected:
            raise TarsGraph.Protected(
                f'WRITE BLOCKED on {target_kind} {target!r}: {reason}. '
                f'Use unlock_project() with Shaun-confirmed approval to override.'
            )

    async def upsert_partner(self, code: str, kind: str = 'other',
                              display_name: str = '', description: str = '') -> EntityNode:
        """Partner = 3rd-party contractor/agency/integrator (e.g. P45)."""
        return await self._upsert_node(
            'Partner', code, summary=description or f'Partner: {display_name or code}',
            attributes={'kind': kind, 'display_name': display_name},
        )

    async def upsert_aws_account(self, account_id: str, alias: str = '') -> EntityNode:
        return await self._upsert_node(
            'AWSAccount', account_id, summary=f'AWS account {alias or account_id}',
            attributes={'alias': alias},
        )

    async def upsert_notion_workspace(self, workspace_id: str, name: str) -> EntityNode:
        return await self._upsert_node(
            'NotionWorkspace', name, summary=f'Notion workspace ({workspace_id})',
            attributes={'workspace_id': workspace_id},
        )

    async def upsert_monday_board(self, board_id: str, name: str, workspace_id: str = '') -> EntityNode:
        return await self._upsert_node(
            'MondayBoard', name, summary=f'Monday board ({board_id})',
            attributes={'board_id': board_id, 'workspace_id': workspace_id},
        )

    async def upsert_monday_workspace(self, workspace_id: str, name: str) -> EntityNode:
        return await self._upsert_node(
            'MondayWorkspace', name, summary=f'Monday workspace ({workspace_id})',
            attributes={'workspace_id': workspace_id},
        )

    async def upsert_domain(self, fqdn: str) -> EntityNode:
        return await self._upsert_node(
            'Domain', fqdn, summary=f'Domain: {fqdn}',
        )

    async def upsert_repo(self, full_name: str, default_branch: str = 'main',
                          archived: bool = False, language: str = '') -> EntityNode:
        return await self._upsert_node(
            'Repo', full_name, summary=f'GitHub repo {full_name}',
            attributes={'default_branch': default_branch,
                        'archived': archived, 'language': language},
        )

    async def projects_by_visibility(self, visibility: str) -> list[dict]:
        """Return all projects matching a visibility (work/personal). Used by
        agents to filter what's eligible for external posting."""
        all_p = await self.all_projects()
        out = []
        import json
        for p in all_p:
            try:
                attrs = json.loads(p.get('attributes') or '{}')
            except Exception:
                attrs = {}
            if attrs.get('visibility') == visibility:
                out.append({**p, 'visibility': visibility, 'kind': attrs.get('kind'), 'business': attrs.get('business')})
        return out

    async def projects_by_business(self, business: str) -> list[dict]:
        """Return all projects matching a business code."""
        all_p = await self.all_projects()
        out = []
        import json
        for p in all_p:
            try:
                attrs = json.loads(p.get('attributes') or '{}')
            except Exception:
                attrs = {}
            if attrs.get('business') == business:
                out.append({**p, 'business': business, 'kind': attrs.get('kind'), 'visibility': attrs.get('visibility')})
        return out

    # upsert_customer removed in v2 — "customer" was the wrong frame.
    # Use upsert_partner() for 3rd-party contractors/agencies. The business
    # designation lives on the Project node itself.

    async def upsert_slack_channel(self, channel_id: str, name: str,
                                    is_connect: bool = False) -> EntityNode:
        return await self._upsert_node(
            'SlackChannel', name, summary=f'Slack channel {name} ({channel_id})',
            attributes={'channel_id': channel_id, 'is_connect': is_connect},
        )

    async def upsert_linear_team(self, key: str, name: str) -> EntityNode:
        return await self._upsert_node(
            'LinearTeam', key, summary=name, attributes={'name': name},
        )

    async def upsert_vercel_project(self, project_id: str, name: str) -> EntityNode:
        return await self._upsert_node(
            'VercelProject', name, summary=f'Vercel project ({project_id})',
            attributes={'project_id': project_id},
        )

    async def upsert_supabase_project(self, project_ref: str, name: str) -> EntityNode:
        return await self._upsert_node(
            'SupabaseProject', name, summary=f'Supabase project ({project_ref})',
            attributes={'project_ref': project_ref},
        )

    async def upsert_service(self, name: str) -> EntityNode:
        return await self._upsert_node(
            'Service', name, summary=f'External service: {name}'
        )

    async def link(
        self, source: EntityNode, target: EntityNode, edge_name: str,
        fact: str, source_tag: str, valid_at: Optional[datetime] = None,
        attributes: Optional[dict[str, Any]] = None,
    ):
        """Create an edge between two existing nodes. source_tag must be a
        VALID_SOURCES value from schema."""
        now = datetime.now(timezone.utc)
        attrs = dict(attributes or {})
        attrs['source'] = source_tag
        attrs['last_synced'] = now.isoformat()
        edge = EntityEdge(
            source_node_uuid=source.uuid, target_node_uuid=target.uuid,
            name=edge_name, fact=fact, group_id=DISCOVERED,
            created_at=now, valid_at=valid_at or now,
            attributes=attrs,
        )
        return await self.graphiti.add_triplet(
            source_node=source, edge=edge, target_node=target,
        )

    # ===== READ API (always discovered-only) =====

    async def get(self, label: str, name: str) -> Optional[dict]:
        """Get a single node by label+name. Returns dict or None."""
        rows, _, _ = await self.driver.execute_query(
            "MATCH (n:Entity) WHERE n.name = $name AND list_contains(n.labels, $label) "
            "AND n.group_id = $gid "
            "RETURN n.uuid AS uuid, n.name AS name, n.labels AS labels, "
            "n.summary AS summary, n.attributes AS attributes LIMIT 1",
            name=name, label=label, gid=DISCOVERED,
        )
        return rows[0] if rows else None

    async def related_to(self, name: str) -> list[dict]:
        """All nodes reachable from a node by one hop, with the linking edge."""
        rows, _, _ = await self.driver.execute_query(
            "MATCH (n:Entity)-[:RELATES_TO]->(r:RelatesToNode_)-[:RELATES_TO]->(m:Entity) "
            "WHERE n.name = $name AND n.group_id = $gid AND r.group_id = $gid "
            "RETURN m.name AS related_name, m.labels AS related_labels, "
            "r.name AS edge_name, r.fact AS fact, r.uuid AS edge_uuid",
            name=name, gid=DISCOVERED,
        )
        return rows

    async def deployments_for(self, repo_full_name: str) -> list[dict]:
        rows, _, _ = await self.driver.execute_query(
            "MATCH (repo:Entity)-[:RELATES_TO]->(r:RelatesToNode_)-[:RELATES_TO]->(target:Entity) "
            "WHERE repo.name = $repo AND list_contains(repo.labels, 'Repo') "
            "AND repo.group_id = $gid AND r.group_id = $gid AND r.name = 'DEPLOYS_TO' "
            "RETURN target.name AS name, target.labels AS labels, r.fact AS fact",
            repo=repo_full_name, gid=DISCOVERED,
        )
        return rows

    async def slack_for(self, project_name: str) -> Optional[dict]:
        rows, _, _ = await self.driver.execute_query(
            "MATCH (p:Entity)-[:RELATES_TO]->(r:RelatesToNode_)-[:RELATES_TO]->(c:Entity) "
            "WHERE p.name = $pname AND list_contains(p.labels, 'Project') "
            "AND p.group_id = $gid AND r.group_id = $gid AND r.name = 'DISCUSSED_IN' "
            "AND list_contains(c.labels, 'SlackChannel') "
            "RETURN c.name AS name, c.attributes AS attributes LIMIT 1",
            pname=project_name, gid=DISCOVERED,
        )
        return rows[0] if rows else None

    async def all_projects(self) -> list[dict]:
        rows, _, _ = await self.driver.execute_query(
            "MATCH (n:Entity) WHERE list_contains(n.labels, 'Project') AND n.group_id = $gid "
            "RETURN n.name AS name, n.summary AS summary, n.attributes AS attributes "
            "ORDER BY n.name",
            gid=DISCOVERED,
        )
        return rows

    async def search(self, query: str, limit: int = 10) -> Any:
        """Semantic+fulltext search via Graphiti — always discovered-only."""
        return await self.graphiti.search_(
            query=query, group_ids=[DISCOVERED],
        )
