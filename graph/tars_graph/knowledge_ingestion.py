"""
Knowledge ingestion worker — reads ~/.tars-state/knowledge/*.yaml and
populates the graph.

Files:
  projects.yaml   — Project metadata + cross-system links
  partners.yaml   — 3rd-party contractor/agency entities (P45 etc.)
  people.yaml     — People (optional; for now skipped)

projects.yaml shape:
  <project_name>:
    kind: product|client|infra|sandbox
    visibility: personal|work
    business: <business code>
    description: ""
    repos: [Apextech-sys/freshbark-2026, ...]
    partners: [p45, ...]                     # FK to partners.yaml
    linear_team: REF                          # FK to existing LinearTeam node
    slack: "#channel-name"                    # FK to existing SlackChannel node
    vercel_project: name                      # FK to existing VercelProject node
    supabase_project: ref                     # FK to existing SupabaseProject node
    aws_account: "140138661997"               # creates AWSAccount node if absent
    notion_workspace: ""                      # creates NotionWorkspace node if absent
    domains: ["freshbark.co.za"]              # creates Domain nodes if absent

All edges written tagged source='knowledge-yaml'.
Idempotent: re-running upserts in place.
"""
from __future__ import annotations

import asyncio
import os
import hashlib
import logging
import sys
import time
from pathlib import Path

import yaml


from tars_graph import TarsGraph
from tars_graph.audit import log_action


KNOWLEDGE_DIR = Path(os.environ.get('TARS_KNOWLEDGE_DIR', '/data/knowledge'))
LOG_PATH = Path(os.environ.get('TARS_LOG_PATH', '/data/discovery.log'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] knowledge-ingest %(message)s',
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
for noisy in ('httpx', 'httpcore', 'openai', 'urllib3', 'graphiti_core.nodes', 'graphiti_core.edges'):
    logging.getLogger(noisy).setLevel(logging.WARNING)
log = logging.getLogger('knowledge-ingest')


async def ingest_partners(g: TarsGraph, partners_file: Path) -> dict:
    if not partners_file.exists():
        log.info(f'no {partners_file.name}, skipping partners')
        return {}
    with partners_file.open() as f:
        data = yaml.safe_load(f) or {}
    nodes = {}
    for code, attrs in data.items():
        if not isinstance(attrs, dict):
            continue
        nodes[code] = await g.upsert_partner(
            code=code,
            kind=attrs.get('kind', 'other'),
            display_name=attrs.get('display_name', ''),
            description=attrs.get('description', ''),
        )
        log.info(f'  partner: {code}')
    return nodes


async def ingest_projects(g: TarsGraph, projects_file: Path, partner_nodes: dict) -> None:
    if not projects_file.exists():
        log.error(f'{projects_file} not found — cannot ingest')
        return
    with projects_file.open() as f:
        data = yaml.safe_load(f) or {}
    for proj_name, attrs in data.items():
        if not isinstance(attrs, dict):
            continue
        kind = attrs.get('kind', 'sandbox')
        visibility = attrs.get('visibility', 'work')
        business = attrs.get('business', 'apex-poc')
        description = attrs.get('description', '')

        # Project nodes get extra protect/review attributes when set in YAML
        extra_attrs = {}
        if attrs.get('protect_mode'):
            extra_attrs['protect_mode'] = True
            extra_attrs['protect_reason'] = attrs.get('protect_reason', '')
        if attrs.get('last_reviewed'):
            extra_attrs['last_reviewed'] = str(attrs['last_reviewed'])

        project_node = await g.upsert_project(
            name=proj_name, kind=kind, business=business,
            visibility=visibility, description=description,
            extra_attributes=extra_attrs or None,
        )
        flags = ' '.join(f'[{k}={v}]' for k, v in extra_attrs.items() if k == 'protect_mode' and v)
        log.info(f'  project: {proj_name} ({kind}/{visibility}/{business}) {flags}'.strip())

        # Link to repos (creates OWNS edges; assumes repos already exist via github discovery)
        for repo_full in attrs.get('repos', []) or []:
            existing = await g._find_node('Repo', repo_full)
            if not existing:
                log.warning(f'    repo {repo_full} not in graph yet — skipping OWNS edge')
                continue
            repo_node = await g.upsert_repo(full_name=repo_full)
            await g.link(
                source=project_node, target=repo_node,
                edge_name='OWNS', fact=f'{proj_name} owns repo {repo_full}',
                source_tag='knowledge-yaml',
            )

        # Partners — Project CONTRIBUTED_BY Partner
        for partner_code in attrs.get('partners', []) or []:
            partner_node = partner_nodes.get(partner_code)
            if not partner_node:
                # Partner not in partners.yaml — best-effort upsert with defaults
                partner_node = await g.upsert_partner(code=partner_code, kind='other')
                partner_nodes[partner_code] = partner_node
            await g.link(
                source=project_node, target=partner_node,
                edge_name='CONTRIBUTED_BY', fact=f'{proj_name} contributed by partner {partner_code}',
                source_tag='knowledge-yaml',
            )

        # Linear team
        linear_team = attrs.get('linear_team', '').strip()
        if linear_team:
            lt = await g._find_node('LinearTeam', linear_team)
            if lt:
                lt_node = await g.upsert_linear_team(key=linear_team, name=lt.get('summary', linear_team))
                await g.link(
                    source=project_node, target=lt_node,
                    edge_name='TRACKED_IN', fact=f'{proj_name} tracked in Linear team {linear_team}',
                    source_tag='knowledge-yaml',
                )
            else:
                log.warning(f'    Linear team {linear_team} not in graph yet')

        # Slack channel
        slack_name = attrs.get('slack', '').strip()
        if slack_name:
            if not slack_name.startswith('#'):
                slack_name = '#' + slack_name
            sc = await g._find_node('SlackChannel', slack_name)
            if sc:
                sc_node = await g.upsert_slack_channel(channel_id='', name=slack_name)
                await g.link(
                    source=project_node, target=sc_node,
                    edge_name='DISCUSSED_IN', fact=f'{proj_name} discussed in Slack {slack_name}',
                    source_tag='knowledge-yaml',
                )
            else:
                log.warning(f'    Slack channel {slack_name} not in graph yet')

        # Vercel
        vercel_name = attrs.get('vercel_project', '').strip()
        if vercel_name:
            vc = await g._find_node('VercelProject', vercel_name)
            if vc:
                vc_node = await g.upsert_vercel_project(project_id='', name=vercel_name)
                await g.link(
                    source=project_node, target=vc_node,
                    edge_name='DEPLOYS_TO', fact=f'{proj_name} deploys to Vercel {vercel_name}',
                    source_tag='knowledge-yaml',
                )
            else:
                log.warning(f'    Vercel project {vercel_name} not in graph yet')

        # Supabase
        sb_ref = attrs.get('supabase_project', '').strip()
        if sb_ref:
            sb = await g._find_node('SupabaseProject', sb_ref)
            if sb:
                sb_node = await g.upsert_supabase_project(project_ref=sb_ref, name=sb_ref)
                await g.link(
                    source=project_node, target=sb_node,
                    edge_name='USES_SERVICE', fact=f'{proj_name} uses Supabase {sb_ref}',
                    source_tag='knowledge-yaml',
                )
            else:
                log.warning(f'    Supabase project {sb_ref} not in graph yet')

        # AWS account
        aws_id = str(attrs.get('aws_account', '')).strip()
        if aws_id:
            aws_node = await g.upsert_aws_account(account_id=aws_id, alias=attrs.get('aws_alias', ''))
            await g.link(
                source=project_node, target=aws_node,
                edge_name='USES_SERVICE', fact=f'{proj_name} uses AWS account {aws_id}',
                source_tag='knowledge-yaml',
            )

        # Notion workspace
        notion_ws = attrs.get('notion_workspace', '').strip()
        if notion_ws:
            n_node = await g.upsert_notion_workspace(workspace_id='', name=notion_ws)
            await g.link(
                source=project_node, target=n_node,
                edge_name='DOCUMENTED_IN', fact=f'{proj_name} documented in Notion {notion_ws}',
                source_tag='knowledge-yaml',
            )

        # Domains
        for fqdn in attrs.get('domains', []) or []:
            d_node = await g.upsert_domain(fqdn=fqdn)
            await g.link(
                source=project_node, target=d_node,
                edge_name='SERVED_AT', fact=f'{proj_name} served at {fqdn}',
                source_tag='knowledge-yaml',
            )


def _content_hash() -> str:
    """Hash of all yaml files in KNOWLEDGE_DIR. If unchanged from last run,
    we skip the expensive graph re-write (was taking ~6 min × every-5-min,
    blocking everything else on the flock)."""
    import hashlib
    h = hashlib.sha256()
    for p in sorted(KNOWLEDGE_DIR.glob('*.yaml')):
        h.update(p.name.encode())
        h.update(b'\x00')
        h.update(p.read_bytes())
        h.update(b'\x00')
    return h.hexdigest()


HASH_MARKER = Path(os.environ.get('TARS_DATA_DIR', '/data') + '/.last_knowledge_hash')


async def main():
    import sys as _sys
    started = time.time()
    log.info('starting knowledge ingestion')
    log_action('cto', 'knowledge_ingestion.start', '', outcome='ok')

    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)

    # Skip if nothing changed (hash-based dedup — yamls are hand-edited, mostly idle)
    current_hash = _content_hash()
    if HASH_MARKER.exists():
        prev_hash = HASH_MARKER.read_text().strip()
        if prev_hash == current_hash and '--force' not in _sys.argv:
            elapsed = time.time() - started
            log.info(f'no changes to knowledge/*.yaml (hash unchanged) — skipping in {elapsed:.2f}s')
            log_action('cto', 'knowledge_ingestion.complete', '', outcome='noop',
                       payload={'duration_s': round(elapsed, 2), 'reason': 'hash_unchanged'})
            return

    async with TarsGraph() as g:
        partner_nodes = await ingest_partners(g, KNOWLEDGE_DIR / 'partners.yaml')
        await ingest_projects(g, KNOWLEDGE_DIR / 'projects.yaml', partner_nodes)

    HASH_MARKER.write_text(current_hash)
    elapsed = time.time() - started
    log.info(f'knowledge ingestion complete in {elapsed:.1f}s')
    log_action('cto', 'knowledge_ingestion.complete', '', outcome='ok',
               payload={'duration_s': round(elapsed, 1)})


if __name__ == '__main__':
    asyncio.run(main())
