"""
Supabase auto-discovery worker for the TARS graph.

Pulls all Supabase projects visible to SUPABASE_ACCESS_TOKEN and upserts:
  - SupabaseProject nodes (name=project.name, project_ref=project.id)

All writes tagged source='supabase'.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from pathlib import Path

import httpx


from tars_graph import TarsGraph
from tars_graph.audit import log_action


LOG_PATH = Path(os.environ.get('TARS_LOG_PATH', '/data/discovery.log'))
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] supabase-discovery %(message)s',
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
for noisy in ('httpx', 'httpcore', 'openai', 'urllib3', 'graphiti_core.nodes', 'graphiti_core.edges'):
    logging.getLogger(noisy).setLevel(logging.WARNING)
log = logging.getLogger('discovery.supabase')


async def fetch_projects(token: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            'https://api.supabase.com/v1/projects',
            headers={'Authorization': f'Bearer {token}'},
        )
        r.raise_for_status()
        return r.json() or []


async def discover():
    started = time.time()
    log.info('starting Supabase discovery')
    log_action('devops-watcher', 'supabase_discovery.start', '', outcome='ok')

    token = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not token:
        log.error('SUPABASE_ACCESS_TOKEN not set — abort')
        sys.exit(1)

    projects = await fetch_projects(token)
    # Diff against last-seen — emit new_supabase_project / removed_supabase_project events
    from tars_graph.events import diff_and_emit
    current_ids = {t['id'] for t in projects if t.get('id')}
    payloads_for_events = {
        t['id']: {'name': t.get('name', ''), 'region': t.get('region', '')}
        for t in projects if t.get('id')
    }
    added, removed = diff_and_emit('supabase', 'new_supabase_project',
                                    'removed_supabase_project', current_ids,
                                    payloads_for_events)
    if added or removed:
        log.info(f'diff: +{len(added)} new, -{len(removed)} removed')
        for x in sorted(added): log.info(f'  NEW: {x}')
        for x in sorted(removed): log.info(f'  REMOVED: {x}')
    log.info(f'projects visible: {len(projects)}')

    async with TarsGraph() as g:
        for p in projects:
            await g.upsert_supabase_project(project_ref=p['id'], name=p['name'])

    elapsed = time.time() - started
    log.info(f'Supabase discovery complete in {elapsed:.1f}s — {len(projects)} projects')
    log_action('devops-watcher', 'supabase_discovery.complete', '', outcome='ok', payload={'duration_s': round(elapsed, 1)})


if __name__ == '__main__':
    asyncio.run(discover())
