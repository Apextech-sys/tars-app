"""
GitHub auto-discovery worker for the TARS graph.

Pulls all repos visible to the GH_TOKEN (user-owned + org memberships),
reads .tars.yaml from each repo root, and upserts into the graph:
  - Repo nodes (always — even repos without .tars.yaml)
  - Project nodes (only when .tars.yaml declares one)
  - OWNS edge: Project -[OWNS]-> Repo

All writes tagged with group_id='discovered' + source='github' (for the Repo
node) or source='tars-yaml' (for the Project link).

Idempotent: re-running upserts in place. Logs to /home/shaun/.tars-state/discovery.log.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml  # graphiti-core already pulled this in transitively? if not, add to requirements


from tars_graph import TarsGraph


LOG_PATH = Path(os.environ.get('TARS_LOG_PATH', '/data/discovery.log'))
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] github-discovery %(message)s',
    handlers=[
        logging.FileHandler(LOG_PATH),
        logging.StreamHandler(sys.stdout),
    ],
)
# Silence chatty libs — we don't want one INFO line per embedding call (~100/run)
for noisy in ('httpx', 'httpcore', 'openai', 'urllib3', 'graphiti_core.nodes', 'graphiti_core.edges'):
    logging.getLogger(noisy).setLevel(logging.WARNING)
log = logging.getLogger('discovery.github')


# ===== gh CLI wrappers =====

def gh_json(args: list[str]) -> object:
    """Run `gh ARGS --json ...` and return parsed JSON. Empty result -> []."""
    res = subprocess.run(
        ['gh'] + args,
        capture_output=True, text=True, timeout=60,
    )
    if res.returncode != 0:
        # gh emits 'no resource' messages on stderr that aren't fatal — log and return []
        log.warning(f'gh {" ".join(args)} failed (rc={res.returncode}): {res.stderr.strip()[:200]}')
        return []
    out = res.stdout.strip()
    if not out:
        return []
    return json.loads(out)


def list_orgs() -> list[str]:
    """Return login names of all orgs the token can see."""
    data = gh_json(['api', 'user/orgs', '--jq', '[.[] | .login]'])
    if isinstance(data, list):
        return data
    return []


def list_user_repos() -> list[dict]:
    """All repos owned by the authenticated user."""
    data = gh_json([
        'repo', 'list', '--limit', '500',
        '--json', 'nameWithOwner,name,owner,defaultBranchRef,isArchived,description,primaryLanguage,visibility,updatedAt',
    ])
    return data if isinstance(data, list) else []


def list_org_repos(org: str) -> list[dict]:
    data = gh_json([
        'repo', 'list', org, '--limit', '500',
        '--json', 'nameWithOwner,name,owner,defaultBranchRef,isArchived,description,primaryLanguage,visibility,updatedAt',
    ])
    return data if isinstance(data, list) else []


def fetch_tars_yaml(full_name: str) -> Optional[dict]:
    """Try to fetch .tars.yaml from the default branch root. Returns parsed dict or None."""
    # gh api returns base64-encoded content for blobs
    res = subprocess.run(
        ['gh', 'api', f'repos/{full_name}/contents/.tars.yaml', '--jq', '.content'],
        capture_output=True, text=True, timeout=30,
    )
    if res.returncode != 0:
        # 404 is normal — most repos won't have it yet
        return None
    import base64
    content_b64 = res.stdout.strip().replace('\n', '')
    if not content_b64:
        return None
    try:
        raw = base64.b64decode(content_b64).decode('utf-8')
        parsed = yaml.safe_load(raw)
        if not isinstance(parsed, dict):
            log.warning(f'{full_name}: .tars.yaml is not a mapping, skipping')
            return None
        return parsed
    except Exception as e:
        log.warning(f'{full_name}: failed to parse .tars.yaml: {e}')
        return None


# ===== main =====

async def discover():
    started = time.time()
    log.info('starting GitHub discovery')

    if not os.environ.get('GH_TOKEN') and not os.environ.get('GITHUB_TOKEN'):
        log.error('No GH_TOKEN or GITHUB_TOKEN in env — abort')
        sys.exit(1)

    # 1. enumerate all repos visible to the token
    user_repos = list_user_repos()
    log.info(f'user-owned repos: {len(user_repos)}')

    orgs = list_orgs()
    log.info(f'orgs visible: {orgs}')

    org_repos: dict[str, list[dict]] = {}
    for org in orgs:
        repos = list_org_repos(org)
        org_repos[org] = repos
        log.info(f'org {org}: {len(repos)} repos')

    all_repos = user_repos + [r for rs in org_repos.values() for r in rs]
    _excl = {x.strip().lower() for x in os.environ.get('TARS_EXCLUDE_REPOS', 'polymarket').split(',') if x.strip()}
    if _excl:
        _before = len(all_repos)
        all_repos = [r for r in all_repos if not any(e in (r.get('nameWithOwner') or '').lower() for e in _excl)]
        log.info(f'excluded {_before - len(all_repos)} repos via TARS_EXCLUDE_REPOS={sorted(_excl)}')
    log.info(f'total repos to scan: {len(all_repos)}')

    # 1b. Diff against last-seen snapshot — emit new_repo / removed_repo events
    # to ~/.tars-state/events.jsonl. Watchers consume these.
    from tars_graph.events import diff_and_emit
    current_ids = {r['nameWithOwner'] for r in all_repos}
    payloads_for_events = {
        r['nameWithOwner']: {
            'language': (r.get('primaryLanguage') or {}).get('name', ''),
            'archived': bool(r.get('isArchived')),
            'description': (r.get('description') or '')[:200],
            'visibility': r.get('visibility', ''),
            'default_branch': (r.get('defaultBranchRef') or {}).get('name', ''),
            'updated_at': r.get('updatedAt', ''),
        }
        for r in all_repos
    }
    added, removed = diff_and_emit('github', 'new_repo', 'removed_repo',
                                    current_ids, payloads_for_events)
    if added or removed:
        log.info(f'diff: +{len(added)} new repos, -{len(removed)} removed')
        for name in sorted(added):
            log.info(f'  NEW: {name}')
        for name in sorted(removed):
            log.info(f'  REMOVED: {name}')

    # 2. fetch .tars.yaml for each
    with_tars_yaml: list[tuple[dict, dict]] = []
    untagged: list[dict] = []
    for r in all_repos:
        if r.get('isArchived'):
            # still upsert as archived=True but don't bother reading .tars.yaml
            untagged.append(r)
            continue
        tars = fetch_tars_yaml(r['nameWithOwner'])
        if tars:
            with_tars_yaml.append((r, tars))
        else:
            untagged.append(r)
    log.info(f'with .tars.yaml: {len(with_tars_yaml)} | untagged: {len(untagged)}')

    # Skip the costly graph re-write (one embedding per repo, all under the
    # single Kuzu writer lock) when the repo set + metadata is unchanged since
    # the last run. Keeps the writer lock window tiny on idle cycles so the
    # read-only blast-radius server stays responsive. Force with --force.
    import hashlib as _hashlib, sys as _sys
    from pathlib import Path as _Path
    _fp = _hashlib.sha256()
    for _r in sorted(all_repos, key=lambda x: x['nameWithOwner']):
        _lang = (_r.get('primaryLanguage') or {}).get('name', '') or ''
        _arch = '1' if _r.get('isArchived') else '0'
        _fp.update((_r['nameWithOwner'] + '|' + _lang + '|' + _arch).encode())
        _fp.update(b'\x00')
    _gh_hash = _fp.hexdigest()
    _gh_marker = _Path(os.environ.get('TARS_DATA_DIR', '/data')) / '.last_github_hash'
    if _gh_marker.exists() and _gh_marker.read_text().strip() == _gh_hash and '--force' not in _sys.argv:
        elapsed = time.time() - started
        log.info(f'GitHub repo set unchanged (hash match) - skipping graph write in {elapsed:.1f}s')
        return

    # 3. write into graph

    async with TarsGraph() as g:
        for r in all_repos:
            full_name = r['nameWithOwner']
            await g.upsert_repo(
                full_name=full_name,
                default_branch=(r.get('defaultBranchRef') or {}).get('name', 'main'),
                archived=bool(r.get('isArchived')),
                language=(r.get('primaryLanguage') or {}).get('name', '') or '',
            )

        for r, tars in with_tars_yaml:
            full_name = r['nameWithOwner']
            project_name = tars.get('project')
            if not project_name or not isinstance(project_name, str):
                log.warning(f'{full_name}: .tars.yaml missing "project" key, skipping link')
                continue
            project = await g.upsert_project(
                name=project_name,
                kind=tars.get('kind', 'product'),  # default
                business=tars.get('business', 'apex-poc'),
                visibility=tars.get('visibility', 'work'),
            )
            repo_node = await g.upsert_repo(
                full_name=full_name,
                default_branch=(r.get('defaultBranchRef') or {}).get('name', 'main'),
                archived=bool(r.get('isArchived')),
                language=(r.get('primaryLanguage') or {}).get('name', '') or '',
            )
            await g.link(
                source=project, target=repo_node,
                edge_name='OWNS',
                fact=f'{project_name} owns repo {full_name}',
                source_tag='tars-yaml',
            )
            log.info(f'  linked {project_name} OWNS {full_name}')

    _gh_marker.write_text(_gh_hash)
    elapsed = time.time() - started
    log.info(f'GitHub discovery complete in {elapsed:.1f}s — {len(all_repos)} repos, {len(with_tars_yaml)} tagged')


if __name__ == '__main__':
    asyncio.run(discover())
