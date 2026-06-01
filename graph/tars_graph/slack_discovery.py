"""
Slack auto-discovery worker for the TARS graph.

Pulls all Slack channels visible to SLACK_BOT_TOKEN and upserts:
  - SlackChannel nodes (name=#channel_name, channel_id, is_connect)

Includes public + private channels the bot is in, and Slack Connect
channels (`is_ext_shared` or `is_pending_ext_shared`).

All writes tagged source='slack'.
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
    format='%(asctime)s [%(levelname)s] slack-discovery %(message)s',
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
for noisy in ('httpx', 'httpcore', 'openai', 'urllib3', 'graphiti_core.nodes', 'graphiti_core.edges'):
    logging.getLogger(noisy).setLevel(logging.WARNING)
log = logging.getLogger('discovery.slack')


async def fetch_channels(token: str) -> list[dict]:
    out: list[dict] = []
    cursor: str | None = None
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                'types': 'public_channel,private_channel',
                'exclude_archived': 'true',
                'limit': '200',
            }
            if cursor:
                params['cursor'] = cursor
            r = await client.get(
                'https://slack.com/api/conversations.list',
                headers={'Authorization': f'Bearer {token}'},
                params=params,
            )
            r.raise_for_status()
            data = r.json()
            if not data.get('ok'):
                log.error(f'Slack API error: {data.get("error")}')
                break
            out.extend(data.get('channels', []))
            cursor = (data.get('response_metadata') or {}).get('next_cursor')
            if not cursor:
                break
    return out


async def discover():
    started = time.time()
    log.info('starting Slack discovery')
    log_action('admin-watcher', 'slack_discovery.start', '', outcome='ok')

    token = os.environ.get('SLACK_USER_TOKEN') or os.environ.get('SLACK_BOT_TOKEN')
    if not token:
        log.error('No SLACK_USER_TOKEN or SLACK_BOT_TOKEN — abort')
        sys.exit(1)

    channels = await fetch_channels(token)
    # Diff against last-seen — emit new_slack_channel / removed_slack_channel events
    from tars_graph.events import diff_and_emit
    current_ids = {t['name'] for t in channels if t.get('name')}
    payloads_for_events = {
        t['name']: {'channel_id': t.get('id', ''), 'is_ext_shared': bool(t.get('is_ext_shared'))}
        for t in channels if t.get('name')
    }
    added, removed = diff_and_emit('slack', 'new_slack_channel',
                                    'removed_slack_channel', current_ids,
                                    payloads_for_events)
    if added or removed:
        log.info(f'diff: +{len(added)} new, -{len(removed)} removed')
        for x in sorted(added): log.info(f'  NEW: {x}')
        for x in sorted(removed): log.info(f'  REMOVED: {x}')
    log.info(f'channels visible: {len(channels)}')

    async with TarsGraph() as g:
        for c in channels:
            name = '#' + c.get('name', '')
            is_connect = bool(c.get('is_ext_shared') or c.get('is_pending_ext_shared'))
            await g.upsert_slack_channel(
                channel_id=c['id'], name=name, is_connect=is_connect,
            )

    elapsed = time.time() - started
    log.info(f'Slack discovery complete in {elapsed:.1f}s — {len(channels)} channels')
    log_action('admin-watcher', 'slack_discovery.complete', '', outcome='ok', payload={'duration_s': round(elapsed, 1)})


if __name__ == '__main__':
    asyncio.run(discover())
