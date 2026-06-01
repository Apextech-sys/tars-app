"""
Vercel auto-discovery worker for the TARS graph.

Pulls all Vercel projects visible to VERCEL_API_TOKEN and upserts:
  - VercelProject nodes (name=project.name, project_id=project.id)

Cross-linking to Repo nodes happens in Phase 3 via .tars.yaml
(`vercel_project: freshbark-2026`).

All writes tagged source='vercel'.
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
    format='%(asctime)s [%(levelname)s] vercel-discovery %(message)s',
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
for noisy in ('httpx', 'httpcore', 'openai', 'urllib3', 'graphiti_core.nodes', 'graphiti_core.edges'):
    logging.getLogger(noisy).setLevel(logging.WARNING)
log = logging.getLogger('discovery.vercel')


async def fetch_projects(token: str) -> list[dict]:
    out: list[dict] = []
    next_cursor: str | None = None
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {'limit': '100'}
            if next_cursor:
                params['until'] = next_cursor
            r = await client.get(
                'https://api.vercel.com/v9/projects',
                headers={'Authorization': f'Bearer {token}'},
                params=params,
            )
            r.raise_for_status()
            data = r.json()
            out.extend(data.get('projects', []))
            pag = data.get('pagination', {})
            next_cursor = pag.get('next')
            if not next_cursor:
                break
    return out


async def discover():
    started = time.time()
    log.info('starting Vercel discovery')
    log_action('devops-watcher', 'vercel_discovery.start', '', outcome='ok')

    token = os.environ.get('VERCEL_API_TOKEN')
    if not token:
        log.error('VERCEL_API_TOKEN not set — abort')
        sys.exit(1)

    projects = await fetch_projects(token)
    # Diff against last-seen — emit new_vercel_project / removed_vercel_project events
    from tars_graph.events import diff_and_emit
    current_ids = {t['name'] for t in projects if t.get('name')}
    payloads_for_events = {
        t['name']: {'project_id': t.get('id', ''), 'framework': t.get('framework', '')}
        for t in projects if t.get('name')
    }
    added, removed = diff_and_emit('vercel', 'new_vercel_project',
                                    'removed_vercel_project', current_ids,
                                    payloads_for_events)
    if added or removed:
        log.info(f'diff: +{len(added)} new, -{len(removed)} removed')
        for x in sorted(added): log.info(f'  NEW: {x}')
        for x in sorted(removed): log.info(f'  REMOVED: {x}')
    log.info(f'projects visible: {len(projects)}')

    async with TarsGraph() as g:
        for p in projects:
            await g.upsert_vercel_project(project_id=p['id'], name=p['name'])

    elapsed = time.time() - started
    log.info(f'Vercel discovery complete in {elapsed:.1f}s — {len(projects)} projects')
    log_action('devops-watcher', 'vercel_discovery.complete', '', outcome='ok', payload={'duration_s': round(elapsed, 1)})


if __name__ == '__main__':
    asyncio.run(discover())
