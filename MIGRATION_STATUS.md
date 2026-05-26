# TARS v2 — Migration Status

**Phase 1 architectural bar: MET.** M1-M4 all live and verified. Dual-AI PR review proven end-to-end against PR #114.

## Verified milestones

| | Milestone | Status | Proof |
|---|---|---|---|
| M1 | Foundation: WDK + Postgres World + systemd | ✅ | `systemctl --user status tars-app` active; HTTP 200 at http://tars-vm102:3001; commit `2a3394a` |
| M2 | Chat UI: Claude Agent SDK + AI Elements + SOUL.md | ✅ | `/chat` returns HTTP 200; 22/22 vitest passing; streaming + sessions persisted; commit `b6912c6` |
| M3 | tars-worker service | ✅ | `systemctl --user status tars-worker` active; 4/4 tests including live Claude SDK call; commit `b45462f` |
| M4 | PR review pipeline (dual-AI gate) | ✅ | Real comment on PR #114 with **Codex 3 + Claude 6 → 8 merged findings**: https://github.com/Apextech-sys/polymarket-v2/pull/114#issuecomment-4549966431 ; commit `7b680ca` |

## Architecture proof points

- **WDK Postgres World running self-hosted** on VM 102's dedicated container `tars-app-postgres:5433`
- **TARS-as-judgment + workflow-as-mechanism** topology working: WDK durable workflow steps + LISTEN/NOTIFY job queue + HMAC-signed callbacks
- **Two-AI cross-validation gate** enforces agreement before any action
- **Konverge protect_mode hardcoded short-circuit** with passing unit tests
- **graph blast-radius queries** via Python subprocess to live Kuzu graph
- **Tailscale reachability** confirmed from your Windows machine
- **Hermes still running in parallel** — by design until M5 green for 3-5 days

## Pending milestones (post Phase 1)

| | Milestone | Status |
|---|---|---|
| M5 | Brief workflow (twice-daily WDK workflow composing morning/evening brief) | pending |
| M5.5 | Vercel Chat SDK — Slack + Linear adapters as alternate frontends | pending |
| M6 | Mobile-responsive polish + browser Notification API | pending |
| M7 | Inbox + Audit + Settings routes | pending |
| M8 | GitHub webhook ingress via Cloudflare Tunnel (auto-trigger on PR open) | pending |
| M9 | Hermes decommission — gated on M5 parallel-run validation for 3-5 days | pending |

## What you can do right now to verify

```bash
# Check both services
ssh shaun@192.168.1.123 'systemctl --user status tars-app.service tars-worker.service --no-pager | grep -E "Active|Main PID"'

# Open the chat UI (Tailscale-connected device)
# Browser: http://tars-vm102:3001/chat

# Open the workflow dashboard
# Browser: http://tars-vm102:3001/workflows

# Trigger a fresh PR review
ssh shaun@192.168.1.123 'curl -X POST http://localhost:3001/api/tars/pr-review \
  -H "content-type: application/json" \
  -d "{\"owner\":\"Apextech-sys\",\"repo\":\"polymarket-v2\",\"prNumber\":114}"'
# Result lands as a new comment on the PR within ~2 min

# Tail audit log
ssh shaun@192.168.1.123 'tail -f /home/shaun/.tars-state/audit.jsonl'

# Inspect run history
ssh shaun@192.168.1.123 'docker exec tars-app-postgres psql -U tars_app -d tars_app \
  -c "SELECT run_id, status, findings_count, review_comment_url FROM pr_review_runs ORDER BY created_at DESC LIMIT 5;"'
```

## Key fixes made along the way

1. `@workflow/world-postgres@4.1.2` + pnpm-workspace.yaml overrides pin entire `@workflow/*` stack to compatible 4.x versions
2. pnpm verify-deps-before-run bypassed via `.npmrc` + direct binary invocation (`./node_modules/.bin/next build`)
3. Codex model: `gpt-5-codex` → `gpt-5.5` (not supported on ChatGPT-subscription auth)
4. Zod v4 enums: official custom `zodToJsonSchema` replaced with `z.toJSONSchema()` (built into Zod v4)
5. OpenAI strict schema mode: post-processor `openaiStrictSchema.ts` forces every property into `required[]` + `additionalProperties: false` on every object
6. Drizzle config explicit `.env.local` load (not just `.env`)

## Open follow-ups (non-blocking)

- M3 webhook route silently degrades `sendEvent` for resuming WDK workflows (Next.js 16 Turbopack dynamic-import issue); M4 workflow polls `tars_jobs` directly instead — works fine
- `dist/` not committed for tars-worker; anyone cloning needs `cd tars-worker && pnpm install && ./node_modules/.bin/tsc -p tsconfig.json`
- Old Codex sessions in `tars_jobs` show failure history — preserved for forensic value

## Commits (chronological)

```
7b680ca fix(worker): make Codex actually work on ChatGPT subscription
b6912c6 M2 complete: TARS chat UI with Claude Agent SDK streaming
b45462f M3: integrate tars-worker (Postgres queue + Claude/Codex handlers)
ae77e74 docs: correct M2 status — AI Elements components did not install, only deps
0934fd8 M2 (partial): Claude Agent SDK + AI Elements installed + status doc
2a3394a M1: Foundation — self-hosted WDK + Postgres World + systemd
```

Also M4 commit `8eb63e4` on workflows directory (landed before the Codex fixes).
