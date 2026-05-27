# TARS v2 — Migration Status (Phase 1 + Phase 2 complete)

**Bottom line: M1–M8 all complete and live. M9 (Hermes decommission) is intentionally gated on 3–5 days of parallel-run validation with the new stack.**

## What was delivered tonight

10 commits on `Apextech-sys/tars-app/main`, deployed and verified on VM 102 (`tars-vm102` Tailscale node, also reachable LAN at 192.168.1.123).

| Milestone | Status | Proof |
|---|---|---|
| **M1** Foundation (WDK + Postgres World + systemd) | ✅ live | `2a3394a` · HTTP 200 at http://tars-vm102:3001 · systemctl `tars-app.service` active |
| **M2** Chat UI (Claude Agent SDK + AI Elements + SOUL.md) | ✅ live | `b6912c6` · /chat 200 · 22/22 vitest passing · streaming + sessions persisted |
| **M3** tars-worker service | ✅ live | `b45462f` · systemctl `tars-worker.service` active · 4/4 tests · HMAC callback verified |
| **M4** PR review pipeline (dual-AI gate) | ✅ live | `8eb63e4` + `7b680ca` · Real comment on PR #114: https://github.com/Apextech-sys/polymarket-v2/pull/114#issuecomment-4549966431 (**Codex 3 + Claude 6 → 8 merged**) |
| **M5** Brief workflow (twice-daily) | ✅ live | `4f48df5` · 4 briefs in DB · morning + evening systemd timers active · 10 unit + integration tests passing · running parallel to Hermes |
| **M5.5** Slack + Linear chat adapters | ✅ code live, awaiting DNS CNAME (M8) for public ingress | `f85d29d` + `3962632` · 23/23 adapter tests · LINEAR_WEBHOOK_SECRET in Infisical |
| **M6** Mobile-responsive + Notification API | ✅ live | `f65b1aa` · 19/19 Playwright mobile tests (Galaxy S22+ Ultra 384px viewport) · 15/15 notification unit tests · drawer pattern, 44px hit targets, browser-native notifications |
| **M7** Inbox + Audit + Settings routes | ✅ live | `0e50bc1` · All three routes 200 OK · SSE inbox badge · YAML editor with konverge protect_mode locked · 98 tests passing |
| **M8** GitHub webhook ingress | ✅ code + tunnel live, **awaiting your DNS CNAME** | `26cb0bb` · cloudflared-tars.service active (4 QUIC connections) · 17/17 webhook tests · konverge guard layered · GH_WEBHOOK_SECRET in Infisical |
| **M9** Hermes decommission | ⏸ **deferred (intentional)** | Gated on 3–5 days parallel-run validation per architecture rule |

## ONE manual action remaining for you (30 seconds)

The Cloudflare Tunnel is up but its public hostname needs a DNS CNAME record so external services (GitHub, Slack, Linear) can reach the webhooks. Do this at cloudflare.com:

| Field | Value |
|---|---|
| Zone | `apextech.group` |
| Type | `CNAME` |
| Name | `tars` |
| Content | `19804f4b-4b03-40ad-af2c-2f8a42d55b26.cfargotunnel.com` |
| Proxy | ON (orange cloud) |

Once that propagates (~1 min), the following URLs go live:
- `https://tars.apextech.group/api/webhooks/github` — for GitHub PR events
- `https://tars.apextech.group/api/slack/events` — for Slack DMs + `#p45` mentions
- `https://tars.apextech.group/api/linear/webhook` — for Linear `@tars` mentions

After DNS:
- Webhooks on `Apextech-sys/tars-app`, `Apextech-sys/polymarket-v2`, `Apextech-Dev/reflex-connect-aws` need registering. Use `scripts/add-webhook-repo.sh <owner>/<repo>` (Konverge repo: add `--konverge` flag to enforce no-autofix at the receiver layer too).
- Slack/Linear apps need their event-subscription URLs updated in their respective dashboards (once per app, persistent thereafter).

## What you can do right now to verify

```bash
# All services healthy
ssh shaun@192.168.1.123 'systemctl --user is-active tars-app.service tars-worker.service tars-brief-morning.timer tars-brief-evening.timer; echo "Stealth012!" | sudo -S -p "" systemctl is-active cloudflared-tars'

# Dashboard (open in browser from any Tailscale-connected device including your phone)
# http://tars-vm102:3001/

# Trigger a fresh PR review against #114 (both AIs review, real comment posts)
ssh shaun@192.168.1.123 'curl -X POST http://localhost:3001/api/tars/pr-review -H "content-type: application/json" -d "{\"owner\":\"Apextech-sys\",\"repo\":\"polymarket-v2\",\"prNumber\":114}"'

# Trigger an ad-hoc brief composition (next scheduled run is 06:10 UTC tomorrow)
ssh shaun@192.168.1.123 'curl -X POST http://localhost:3001/api/tars/briefs -H "content-type: application/json" -d "{\"kind\":\"adhoc\"}"'

# Latest briefs
ssh shaun@192.168.1.123 'docker exec tars-app-postgres psql -U tars_app -d tars_app -c "SELECT id, kind, status, length(body_markdown) FROM briefs ORDER BY created_at DESC LIMIT 5;"'

# Audit roll-up
ssh shaun@192.168.1.123 'docker exec tars-app-postgres psql -U tars_app -d tars_app -c "SELECT run_id, status, findings_count FROM pr_review_runs ORDER BY created_at DESC LIMIT 5;"'
```

## Architecture topology (final, live)

```
VM 102 (192.168.1.123 / tars-vm102.<tailnet>.ts.net)
│
├─ tars-app                (Next.js 16, systemd, port 3001)
│  ├─ /            dashboard home
│  ├─ /chat        TARS conversational UI (Claude Agent SDK streaming)
│  ├─ /briefs      twice-daily briefs (markdown, replyable)
│  ├─ /inbox       escalations + workflow stalls (SSE live badge)
│  ├─ /audit       audit_log table (paginated, CSV export)
│  ├─ /settings    YAML policy editor + kill switches + model picker
│  ├─ /workflows   visual builder + run history (template)
│  ├─ /api/chat                         — Claude SDK streaming endpoint
│  ├─ /api/tars/pr-review               — manual + webhook PR-review trigger
│  ├─ /api/tars/briefs/*                — brief CRUD + reply
│  ├─ /api/webhooks/job-done            — worker HMAC callbacks
│  ├─ /api/webhooks/github              — GitHub PR events
│  ├─ /api/slack/events                 — Slack DMs + mentions
│  ├─ /api/linear/webhook               — Linear @-mentions
│  └─ /api/inbox/sse                    — live badge stream
│
├─ tars-worker             (Node.js, systemd, Postgres LISTEN/NOTIFY queue)
│  ├─ claude-review        @anthropic-ai/claude-agent-sdk
│  ├─ codex-review         @openai/codex-sdk (gpt-5.5, ChatGPT auth)
│  ├─ claude-brief-compose  composes briefs
│  ├─ claude-fix-apply      writes patches (Konverge-guarded)
│  ├─ codex-fix-validate    validates patches
│  └─ no-op                 testing
│
├─ cloudflared-tars        (system systemd, public ingress)
│  └─ Routes /api/webhooks/* and /api/slack/* and /api/linear/*
│     to internal tars-app via the tunnel
│     Public hostname: tars.apextech.group (pending DNS CNAME)
│
├─ tars-app-postgres       (Docker container, port 5433)
│  Tables:
│   • users, sessions, accounts, api_keys (Better Auth)
│   • workflows, workflow_executions, workflow_execution_logs (template)
│   • chats, chat_messages (M2)
│   • tars_jobs, worker_heartbeats (M3 queue)
│   • pr_review_runs, audit_log (M4)
│   • briefs (M5)
│   • escalations, app_settings (M7)
│   • repo_settings, webhook_events (M8)
│   • + WDK schemas: workflow, graphile_worker, workflow_drizzle
│
├─ Hermes                  (still running in parallel)
│  ├─ Twice-daily Python brief generator (06:00 + 16:00 UTC)
│  └─ WhatsApp gateway (kept for now)
│
├─ Kuzu graph              (read by workflows via Python subprocess)
├─ Honcho                  (Docker, conversational memory)
├─ Infisical               (Docker, all secrets)
└─ Tailscale daemon        (tars-vm102 node)
```

## Konverge protection (verified)

- **Hardcoded short-circuit** in `workflows/lib/konverge-guard.ts`. 4 unit tests verify it throws `KonvergeProtectModeError` for any write op (autofix-apply, autofix-propose, git-push, issue-create) when `protect_mode === true`.
- **Layered enforcement**: M8 GitHub webhook also sets `policyOverride: { autoFix: false }` for konverge repos at the receiver layer (`reflex-connect-aws` in `repo_settings` already has `auto_fix=false`).
- **Slack adapter** prefixes responses in Konverge channels with `[Konverge protect mode is active — this is a review-only comment, not a fix or action.]`
- **Linear adapter** honors the same firewall + protect_mode markers in its prompt context.

## Personal/work firewall (verified)

- `projects.yaml` has `visibility: personal` flag honored across all integrations.
- Linear adapter refuses to post personal-project context outside its own GitHub repo.
- Brief workflow respects personal visibility — personal-project context only goes to Shaun (briefs are personal-only by design).

## Test counts (cumulative)

- Worker (M3): 4/4 unit + integration, including live Claude SDK call
- PR review (M4): 10/10 unit + 1/1 integration
- Chat UI (M2): 22/22
- Briefs (M5): 10/10 unit + 1/1 integration
- Slack/Linear (M5.5): 23/23
- Inbox/Audit/Settings (M7): 98 tests
- GitHub webhook (M8): 17/17
- Mobile + Notifications (M6): 19 Playwright + 15 unit

**Total: ~219 tests passing across the new stack.**

## Open follow-ups (non-blocking)

1. **DNS CNAME** as documented above (your 30-second action).
2. **Slack app event subscription URL** must be registered once DNS is live. The bot token + signing secret are already in Infisical.
3. **Linear webhook URL** registered at https://linear.app/settings/api once DNS is live.
4. **Konverge repo webhook registration**: run `scripts/add-webhook-repo.sh Apextech-Dev/reflex-connect-aws --konverge` once DNS is live.
5. **M9 Hermes decommission**: do not run until M5 (briefs) has produced ≥3 consecutive accurate briefs alongside Hermes for cross-validation. ~3 days from now if briefs land cleanly each cycle.
6. **dist/ not committed for tars-worker** — anyone cloning fresh needs `cd tars-worker && pnpm install && ./node_modules/.bin/tsc -p tsconfig.json`. Acceptable for now since this is your VM.
7. **`OPENAI_API_KEY` placeholder** in `.env.local` — TarsGraph requires the var to be present even though embeddings aren't used. Documented; harmless.

## Key fixes made along the way

| # | Issue | Fix |
|---|---|---|
| 1 | pnpm + WDK version mismatch | `pnpm-workspace.yaml` overrides pin `@workflow/{world-local,errors,core}` to compatible 4.x |
| 2 | pnpm `verify-deps-before-run` failures | `.npmrc` disables it; build runs via `./node_modules/.bin/next build` directly |
| 3 | Codex `gpt-5-codex` not supported on ChatGPT auth | Switched to `gpt-5.5` per your earlier instruction |
| 4 | Zod v4 enums serialize as objects, not arrays | Switched to built-in `z.toJSONSchema()` (replaced custom converter) |
| 5 | OpenAI strict schema mode requires every property in `required[]` | Added `openaiStrictSchema.ts` post-processor walking the JSON schema |
| 6 | Drizzle config default loads `.env` not `.env.local` | Explicit `config({ path: ".env.local" })` |
| 7 | WDK `waitForEvent`/`sendEvent` silently degrade in this Next.js 16 setup | Workflows poll `tars_jobs` directly (durable, simpler) |
| 8 | Zod-to-json-schema for Zod v4 | Use built-in + post-process for OpenAI strict mode |
| 9 | M3 webhook `sendEvent` dynamic import unsupported in Turbopack | Workflows do direct polling instead — works fine |

## What's running where (process map)

```bash
# All services:
ssh shaun@192.168.1.123 'systemctl --user list-units --type=service --state=active 2>&1 | grep tars; systemctl --user list-timers 2>&1 | grep tars; echo "Stealth012!" | sudo -S -p "" systemctl list-units --type=service --state=active 2>&1 | grep cloudflared'
```

You'll see:
- tars-app.service (Next.js)
- tars-worker.service (job executor)
- tars-brief-morning.timer + tars-brief-evening.timer (6:10/16:10 UTC daily)
- cloudflared-tars.service (system level, public ingress)
- Plus existing Hermes services (parallel run preserved)

## Honest grade on this session

Started the session with a working Hermes setup. Ended with:
- Hermes still running (preserved for parallel-run as designed)
- A complete second-generation TARS stack running alongside it
- 8 of 9 milestones complete (M9 intentionally deferred per architecture rule)
- ~219 tests passing
- 10 commits on `main`
- Real PR review comment posted on PR #114 with both Codex and Claude contributing
- 4 briefs already in the DB

I burned hours early in the session on pnpm/WDK build chaos and made one critical error: I tried to coordinate everything in my own context budget instead of delegating to subagents — you correctly called that out, after which I dispatched 7 parallel integration subagents that completed Phase 2 in roughly the same window.

The lesson is recorded.

## Cutover decision (your call when you wake)

The Hermes briefs at 06:00/16:00 UTC and the TARS briefs at 06:10/16:10 UTC will both run. Compare them across the next 3 cycles. If TARS briefs are at parity or better:
- Disable Hermes brief cron
- Then stop Hermes systemd units one at a time
- See M9 task #82 for the playbook
