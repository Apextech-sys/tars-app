# TARS-OS Roadmap — Insights, Reporting & Management System for Reflex Connect

**Owner:** TARS (autonomous build, approved by Shaun 2026-06-02 — "map the entire process then implement, you do not need my approval, ensure it is tested and working").
**Status doc.** Authoritative build plan. Updated as phases land.

## The spine (what makes it a *system*, not integrations)
Every source feeds the **graph**. Workflows: **sense → analyze (graph-grounded) → act/insight → surface to the right role**, humans gate anything that writes. The graph is the moat: a cost spike → the deploy that caused it → the PR → the ticket → the person → the doc. Insights are only as good as what's in the graph, so **connect first, then workflow, then surface** — as vertical slices, each tested.

## Hard guardrails (non-negotiable)
- **RC codebase is human-gated-write only.** TARS may open commit-for-review PRs (branch + PR) to RC repos, but **NEVER pushes to or merges protected branches** (`main`/`master`/`develop`/`dev`/`v2-main`) and **never auto-merges**. A human is the only actor that changes RC code. If a workflow would require TARS to modify RC code directly, **STOP**. (Enforced by `PROTECTED_BASE_RE` in the fix stage + a global no-auto-merge rule.)
- **Never depend on VM-102** — everything is Dokploy-native (`vm102-was-poc-only`).
- **Cite-or-it-didn't-happen** — every insight/number drills to its graph source; verify against real data, not unit tests (`feedback-claimed-vs-real`).
- **Front-end is first-class** — every workflow ships a real surface, not a JSON dump (`feedback-frontend-first-class`).

## Audiences & their primary needs
- **EXCO** — one-page delivery/risk/cost/security/throughput; KPI trends; ask-TARS Q&A.
- **PMO** — cycle health (grounded vs real code activity), cross-project rollups, DORA, drift, meeting→actions.
- **Architects** — architecture drift (code-graph vs ADRs), change-impact/blast-radius, standards, debt hotspots.
- **DevOps** — deploy timeline, env health, incidents (alarm→deploy→PR correlation), cost anomalies.
- **Developers** — PR review→fix (live), code-a-ticket, bug-fix (Sentry→root-cause), ask-the-codebase.
- **Security** — vuln-triage (finding × blast-radius), access/audit anomalies, posture, compliance (POPIA/telco).

## Already built (the sound base)
5 Dokploy services: tars-app (Next.js + WDK), tars-worker (Claude+Codex SDK), tars-db, tars-graph (Kuzu code-graph 1078 files/2070 imports + Graphiti entity graph + ingestion), tars-monitor. Live workflows: dual-AI PR-review→fix→Linear; twice-daily brief; Notion knowledge (docs↔code↔tickets). Graph already ingests: GitHub, Linear, Vercel, Supabase, Slack, Notion(partial).

---

## PHASE 0 — Foundations everything depends on (parallel with Phase 1)
**0a. Identity + RBAC + SSO→roles.** Map M365/Entra SSO identity → roles (exco/pmo/architect/devops/dev/security). Approval boundaries per role. Per-person identity in the graph (link to GitHub/Linear/Slack handles). 
**0b. Role-aware app shell.** Navigation + role homes scaffold for all 6 audiences; route guards by role; "My TARS" per-person view skeleton.
**0c. Connector framework.** Formalize the graph discovery/ingestion pattern (worker → diff → emit nodes/edges → scheduler hook → server endpoint) so every new source is a repeatable slice.
**0d. Comms — Teams chat adapter.** Add a Microsoft Teams adapter to the existing Vercel Chat SDK (two-way chat, alongside the M5.5 Slack + Linear adapters). Notifications stay on direct Slack (no Novu/Knock — decided 2026-06-02). So TARS chat is reachable from Teams + Slack + the web dashboard.
**DoD:** a user logging in via SSO lands on their role home; routes guarded; new-connector pattern documented; TARS answers in a Teams channel.

## PHASE 1 — AWS connector + infra/cost/security data spine *(START HERE)*
Read-only AWS ingestion worker (Infisical AWS-readonly creds) → graph nodes:
- **Resources** (by service/account/region/tag) — EC2/ECS/EKS/Lambda/RDS/S3/etc. inventory.
- **CloudWatch** — alarms (state) + key metrics snapshots; logs pointers.
- **Cost** — Cost Explorer / CUR by service+tag+day (+ anomalies).
- **CloudTrail** — notable events (for security/audit).
- **Security Hub / GuardDuty / Inspector** — findings.
Edges link AWS resources → repos/services (via tags/naming) so infra ties to code/PRs.
Endpoints: `/aws/resources`, `/aws/cost`, `/aws/alarms`, `/aws/findings`. Incremental scheduler hook.
**DoD:** real RC AWS data in the graph; endpoints return live resources/cost/alarms; a resource resolves to its repo.

## PHASE 2 — DevOps surface + workflows
- **FE:** Infra/DevOps surface — services, **deploy timeline** (AWS + Vercel + Dokploy), env health, incidents, cost panel.
- **Workflows:** **incident** (CloudWatch alarm → correlate to recent deploy+PR via graph → route/alert → post-mortem → Linear); **cost-anomaly** (spike → attribute to service/tag/deploy); **deploy-timeline** ingest; env-health rollup (generalize the dead-man monitor).
**DoD:** an injected alarm produces a correlated incident card + Slack alert + Linear item; cost panel shows real spend.

## PHASE 3 — Cloudflare + Snyk + Security surface + workflows
- **Connect:** Cloudflare (Analytics, WAF/firewall events, Access logs, tunnel health); Snyk/Dependabot/secret-scanning.
- **FE:** Security surface — findings, posture score, **vuln→remediation tracking**, access/audit log.
- **Workflows:** **vuln-triage** (finding → severity × blast-radius "which services use this dep" → owner → track to fix); access-anomaly review; weekly posture report.
**DoD:** a Snyk/GuardDuty finding becomes a tracked, owner-assigned, blast-radius-scored item; posture report generates.

## PHASE 4 — Sentry + APM + Developer workflows
- **Connect:** Sentry (errors); OpenTelemetry/metrics path (Grafana/Datadog) for runtime health.
- **FE:** Developer "My TARS" (my PRs/reviews/tickets/alerts) + **ask-the-codebase** chat (graph-grounded, cite-or-it-didn't-happen).
- **Workflows:** **bug-fix** (Sentry error → reproduce → root-cause via graph → **human-gated** fix PR → test); **code-a-ticket** (Linear → Claude/Codex session → **human-gated** PR into review pipeline); PR risk scoring. **All writes are commit-for-review PRs only — TARS never merges/pushes to protected branches (RC guardrail).**
**DoD:** a Sentry error drives a bug-fix PR (open, not merged) through the review lifecycle; code-a-ticket produces a PR a human can merge; no protected-branch writes ever occur.

## PHASE 5 — PMO surface + workflows
- **Connect:** monday + full Notion + M365 (Outlook/Teams/SharePoint + Circleback meeting notes).
- **FE:** Delivery/PMO board — cycles, cross-project rollups (14 REF projects), DORA/cycle-time/lead-time, drift.
- **Workflows:** **cycle-health** (Linear progress *grounded against real PR/commit activity*); cross-project rollup; meeting-notes→action-items→Linear.
**DoD:** PMO board shows cycle health that flags ticket-vs-code drift; a meeting transcript yields tracked action items.

## PHASE 6 — EXCO insights + KPI + Reports
- **FE:** EXCO role home + **KPI dashboards** (DORA, velocity, cost trend, incident MTTR, open/closed findings) + **Reports** (daily/weekly/exec, scheduled, export to PDF/Slack/Notion).
- **Workflows:** weekly exec brief (extend twice-daily); **KPI pipeline**; cost forecast; **Ask-TARS exec Q&A** (whole-graph).
**DoD:** weekly exec brief auto-generates + posts; KPI dashboard shows real DORA/cost/MTTR; exec Q&A answers a real question with citations.

## PHASE 7 — Graph explorer + unified search + polish
- **FE:** **graph explorer** (visualize entity+code graph + blast-radius — the differentiator, made visible); **unified search**; notification routing; drill-down on every number to its source.
- **Cross-cutting:** approval/inbox gate for all writes; real-time updates; in-app + Slack + browser notifications.
**DoD:** any number on any surface drills to its graph source; explorer renders the live graph; search spans code+tickets+docs+infra.

---

## Per-slice definition of done (every phase)
Tested + working against **real data** (not unit tests alone — per `feedback-claimed-vs-real`); FE surface included (per `feedback-frontend-first-class`); committed + deployed on Dokploy + verified live (containers/logs/data, not just API 200s); ledger/memory updated; no new debt left from the slice (per `feedback-recursive-cleanup-chains`). Subagents externally time-boxed + monitored (per `subagent-timebox-externally`). Never depend on VM-102 (`vm102-was-poc-only`).

## Build order rationale
AWS first (biggest gap; unlocks devops/security/EXCO cost+risk+uptime numbers). Phase 0 identity/RBAC runs in parallel (every surface needs it). DevOps+Security next (they consume AWS+CF and produce the EXCO-visible metrics). Dev workflows + PMO + EXCO build on the accumulated graph. Graph explorer + polish last.
