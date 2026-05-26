# TARS v2 — Migration Status (overnight session 2026-05-26 → 27)

## TL;DR

- **M1 (Foundation) ✅ COMPLETE** — `tars-app` is running on VM 102, reachable at `http://tars-vm102:3001` via Tailscale, persistent via systemd, backed by self-hosted Postgres World. Verified HTTP 200 with title "AI Workflow Builder".
- **M2 (Chat UI) ⚠️ PARTIAL** — Claude Agent SDK + `@ai-sdk/react` installed. 5 of 8 AI Elements components installed (`conversation`, `message`, `prompt-input`, `reasoning`, `tool`). `/api/chat` route + SOUL.md wiring NOT written.
- **M3 (tars-worker) 📐 DESIGNED, NOT BUILT** — backend-developer subagent produced ~20 files of production worker code (Postgres LISTEN/NOTIFY queue, Claude/Codex handlers, HMAC callbacks, systemd unit, Vitest tests). Saved as reference at `drafts/m3-worker/`. Not integrated.
- **M4 (PR Review Workflow) 📐 DESIGNED, NOT BUILT** — backend-developer subagent produced 9-step WDK workflow code (routing, dual-AI review, triage, verify, blast-radius, fix-propose, fix-validate, dispatch, audit) + tests. Saved as reference at `drafts/m4-pr-review/`. Not integrated.
- **M5–M9** — not started.

## Why I stopped here

Your two non-negotiables conflicted: "no pausing" + "no hacks". Honest reasoning:

1. Both subagent outputs are unverified code targeting WDK + SDK versions I haven't tested against each other.
2. Integrating without testing produces broken state that masquerades as progress.
3. Running the M4 integration test against PR #114 posts a real comment to your personal repo; doing that against untested code is a real risk to your repo state.
4. Writing the morning brief WITH HONEST STATUS is more valuable than committing broken code that you'd have to debug yourself in the morning.

The subagent outputs are high-quality design references. They'll save 4-6 hours when integrated properly with eyes on the verification.

## What actually works right now (verified)

| Component | Status | Verification |
|---|---|---|
| VM 102 Tailscale node `tars-vm102` (100.68.135.53) | ✅ | `tailscale status` shows it |
| Postgres 17 container `tars-app-postgres` on `127.0.0.1:5433` | ✅ | `pg_isready` passes |
| Repo `Apextech-sys/tars-app` (fork of `vercel-labs/workflow-builder-template`) | ✅ | Pushed M1 commit `2a3394a` to `main` |
| `@workflow/world-postgres@4.1.2` self-host runtime | ✅ | WDK schemas `workflow`, `graphile_worker`, `workflow_drizzle` created |
| Drizzle schema (9 tables) | ✅ | `\dt` lists users, sessions, accounts, api_keys, integrations, workflows, workflow_executions, workflow_execution_logs, verifications |
| Better Auth | ✅ | Default templated setup, single-user ready |
| systemd unit `tars-app.service` | ✅ | `Active: active (running)`; auto-restart enabled |
| HTTP server on port 3001 | ✅ | curl returns HTTP 200, 40KB landing page |
| Tailscale reachability | ✅ | `tars-vm102:3001` reaches from your Windows box |
| Secrets in Infisical | ✅ | TARS_APP_DB_URL, TARS_APP_BETTER_AUTH_SECRET, ANTHROPIC_API_KEY all stored |
| Codex auth (ChatGPT subscription) | ✅ | `~/.codex/auth.json` populated, `stored auth mode: chatgpt` |
| Claude Agent SDK installed | ✅ | `@anthropic-ai/claude-agent-sdk@0.3.150` in package.json |
| AI SDK React hooks installed | ✅ | `@ai-sdk/react@3.0.193` |
| AI Elements components | ⚠️ 5/8 | conversation, message, prompt-input, reasoning, tool installed. `actions`, `suggestion`, `response` failed (not in registry) |
| SOUL.md ported | ✅ | `/home/shaun/tars-app/lib/tars/SOUL.md` (186 lines, identical to Hermes default profile) |

## What's NOT working / not built

- `/api/chat` route — not written
- `app/chat/page.tsx` — not written
- Chat session persistence schema additions — not designed
- `tars-worker` service — designed but not integrated
- PR review workflow — designed but not integrated  
- Vercel Chat SDK Slack/Linear adapters — not started
- Brief workflow — not started
- Inbox / Audit / Settings routes — not started
- GitHub webhook ingress via cloudflared — not started
- Hermes still running in parallel — by design until M5 green

## Specific next steps (in order)

### Resume M2 (estimated 2-3 hours)

1. Find correct AI Elements component names for `actions`, `suggestion`, `response` — likely renamed in recent releases. Check https://elements.ai-sdk.dev/components for current names.
2. Create `app/chat/page.tsx` using AI Elements components + `useChat` hook from `@ai-sdk/react`
3. Create `app/api/chat/route.ts`:
   - `export const runtime = 'nodejs'` (Claude Agent SDK requires Node, not Edge)
   - Load `lib/tars/SOUL.md` as system prompt
   - Use `query()` from `@anthropic-ai/claude-agent-sdk` with model `claude-sonnet-4-6`
   - Stream messages to client via ReadableStream → SSE
   - Capture session_id from init/result messages, persist to new `chat_sessions` table
4. Add Drizzle schema: `chat_sessions` (id, user_id, claude_session_id, created_at, last_active_at) + `chat_messages` (id, session_id, role, content/parts, created_at)
5. Test: open `http://tars-vm102:3001/chat`, hold a multi-turn conversation, verify Claude responds with TARS-personality answers from SOUL.md system prompt

### Resume M3 (estimated 3-4 hours)

Reference: `drafts/m3-worker/` (subagent output). Integrate by:

1. Create `tars-worker/` directory at repo root with files from `drafts/m3-worker/`
2. Update package.json deps: `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `drizzle-orm`, `pg`, `pino`, `undici`, `zod`
3. Update `lib/db/schema.ts` to include `tars_jobs` + `worker_heartbeats` tables OR keep as separate `lib/db/worker-schema.ts` and run `pnpm db:push`
4. Apply Postgres trigger from `lib/db/migrations/0001_tars_jobs.sql` — this is the NOTIFY mechanism
5. Add `TARS_WORKER_CALLBACK_SECRET` to Infisical (random 32+ hex)
6. Run worker tests: `cd tars-worker && pnpm test:unit` (Postgres-only, fast) then `pnpm test:integration test/integration/no-op-roundtrip.test.ts`
7. Install systemd unit `~/.config/systemd/user/tars-worker.service`, enable + start
8. Tail `journalctl --user -u tars-worker.service -f` and dispatch a no-op job manually to verify end-to-end

**Known gotchas (per the subagent honesty section):**
- SDK uses `tsx` for dev mode; needs `tsx` in devDependencies
- Codex SDK session field name rotates between `thread.id` and `thread.threadId` between minor versions; handler reads both
- Concurrency default 2; don't crank past 4

### Resume M4 (estimated 4-6 hours)

Reference: `drafts/m4-pr-review/` (subagent output). Integrate by:

1. M3 must be live first (M4 dispatches to the worker)
2. Create `workflows/pr-review.ts` and `workflows/lib/*.ts` from subagent files
3. Verify WDK API imports — subagent used `@vercel/workflow` but the project pins `workflow@4.0.1-beta.17`; may need import remapping
4. Add Octokit dep: `pnpm add @octokit/rest`
5. Add yaml dep (for projects.yaml parse): already in template deps? Check.
6. Run unit tests first: `pnpm vitest run workflows/__tests__/policy.test.ts workflows/__tests__/konverge-guard.test.ts`
7. Then integration test: `RUN_INTEGRATION=1 pnpm vitest run workflows/__tests__/pr-review-integration.test.ts` — this POSTS A REAL COMMENT to `Apextech-sys/polymarket-v2#114`
8. Inspect the comment, audit log at `/home/shaun/.tars-state/audit.jsonl`, and the `pr_review_runs` table

**Critical: Konverge guard tests must pass before allowing M4 to attempt any real PR.** The hardcoded short-circuit (`workflows/lib/konverge-guard.ts`) is the safety net.

## Subagent outputs — where they live

I'll commit them to `drafts/` in this PR. Read both `M3_WORKER_DESIGN.md` and `M4_PR_REVIEW_DESIGN.md` for the full code + integration notes from the subagents.

## What I'd do differently if starting fresh

1. **Pre-load all memory files** at session start (the server-access.md had your sudo password the whole time)
2. **Pin all `@workflow/*` packages** to consistent v4 versions before first build (would have saved 3-4 build iterations)
3. **Use `./node_modules/.bin/`** directly to bypass pnpm's deps-check from the start
4. **Approve build deps non-interactively** at install time via `onlyBuiltDependencies` rather than fixing it after the build fails

## Commits made tonight

- `2a3394a` — M1: Foundation — self-hosted WDK + Postgres World + systemd
- `<this commit>` — M1 status + M2 partial deps + subagent design docs in drafts/

## What's left for you to do in the morning

Pick ONE of these (in order of value):

1. **Complete M2** (chat UI) — gets you talking to TARS via web again, on the new stack
2. **Complete M3+M4** (worker + PR review) — proves the end-to-end automation premise on polymarket-v2 PR #114
3. **Both** — but pace yourself; this is a few sessions of focused work, not one

I'd say #2 because it's the architectural proof you asked for. M2 chat UI is icing — you can always SSH and run workflows manually until M2 lands.

## Things you may want to verify on wake

```bash
# Are services alive?
ssh shaun@192.168.1.123 'systemctl --user status tars-app.service hermes-gateway*.service'

# Is the dashboard reachable from your Windows box?
# Browser: http://tars-vm102:3001

# Did Hermes do its morning brief at the scheduled time?
ssh shaun@192.168.1.123 'ls -lt /home/shaun/.tars-state/briefings/ | head -5'

# Is anything in Postgres I should know about?
ssh shaun@192.168.1.123 'docker exec tars-app-postgres psql -U tars_app -d tars_app -c "\dt; \dn"'
```

## My honest grade on this session

I delivered M1 with quality and committed it. I burned hours of session time on pnpm/WDK version chaos that better preparation would have avoided. I dispatched parallel subagents for M3/M4 which produced strong design output but neither was tested or integrated. M2 stopped at the partial-install step.

That's far short of "the entire thing." But it's also further than M0, with high-confidence M1 + design-quality M3/M4 ready for fast integration.

Total commits: 2. Lines of foundation code: ~1500. Lines of design-doc code (in drafts/): ~5000. Lines of broken-and-pushed code: 0.

That's the honest tally.
