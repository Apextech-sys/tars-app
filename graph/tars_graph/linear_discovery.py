"""
Linear auto-discovery worker for the TARS graph.

Pulls all Linear teams visible to LINEAR_API_KEY and upserts:
  - LinearTeam nodes (name=team.key, e.g. 'P45', 'REF')

Cross-linking to Project nodes happens in Phase 3 via .tars.yaml
(`linear_team: P45`) — not in this worker.

All writes tagged source='linear'.
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
    format='%(asctime)s [%(levelname)s] linear-discovery %(message)s',
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
for noisy in ('httpx', 'httpcore', 'openai', 'urllib3', 'graphiti_core.nodes', 'graphiti_core.edges'):
    logging.getLogger(noisy).setLevel(logging.WARNING)
log = logging.getLogger('discovery.linear')


LINEAR_GRAPHQL = 'https://api.linear.app/graphql'

QUERY_TEAMS = """
query {
  teams(first: 250) {
    nodes { id key name description }
  }
}
"""


async def fetch_teams(api_key: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            LINEAR_GRAPHQL,
            headers={'Authorization': api_key, 'Content-Type': 'application/json'},
            json={'query': QUERY_TEAMS},
        )
        r.raise_for_status()
        data = r.json()
    if 'errors' in data:
        log.error(f'Linear API errors: {data["errors"]}')
        return []
    return data.get('data', {}).get('teams', {}).get('nodes', [])


async def discover():
    started = time.time()
    log.info('starting Linear discovery')
    log_action('admin-watcher', 'linear_discovery.start', '', outcome='ok')

    api_key = os.environ.get('LINEAR_API_KEY')
    if not api_key:
        log.error('LINEAR_API_KEY not set — abort')
        sys.exit(1)

    teams = await fetch_teams(api_key)
    # Diff against last-seen — emit new_linear_team / removed_linear_team events
    from tars_graph.events import diff_and_emit
    current_ids = {t['key'] for t in teams if t.get('key')}
    payloads_for_events = {
        t['key']: {'name': t.get('name', ''), 'description': (t.get('description') or '')[:200]}
        for t in teams if t.get('key')
    }
    added, removed = diff_and_emit('linear', 'new_linear_team',
                                    'removed_linear_team', current_ids,
                                    payloads_for_events)
    if added or removed:
        log.info(f'diff: +{len(added)} new, -{len(removed)} removed')
        for x in sorted(added): log.info(f'  NEW: {x}')
        for x in sorted(removed): log.info(f'  REMOVED: {x}')
    log.info(f'teams visible: {len(teams)}')

    async with TarsGraph() as g:
        for t in teams:
            await g.upsert_linear_team(key=t['key'], name=t['name'])
            log.info(f'  upsert LinearTeam: {t["key"]} ({t["name"]})')

    elapsed = time.time() - started
    log.info(f'Linear discovery complete in {elapsed:.1f}s — {len(teams)} teams')
    log_action('admin-watcher', 'linear_discovery.complete', '', outcome='ok', payload={'duration_s': round(elapsed, 1)})


if __name__ == '__main__':
    asyncio.run(discover())
