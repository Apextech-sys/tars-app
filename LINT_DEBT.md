# TARS Lint Debt Ledger

Last updated: 2026-05-27
Baseline: `pnpm check` exits 1 with 138 errors / 0 warnings.

## Why this exists

Biome is configured strict for the TARS app. The mechanical sweeps (useTopLevelRegex, noSubstr, noEmptyBlockStatements, noVoid, obsolete suppression comments) have been cleared. The findings tracked below are real engineering decisions per occurrence — type debt, refactor candidates, correctness investigations — not search-and-replace work.

Tracked here so the debt is visible. The convention is: when you modify a file in this list, fix the findings in that file as part of the same change. Update this ledger by removing fixed entries. When a category drops to zero, delete its section. When the whole file is empty, delete the ledger.

## Categories (in priority order)

### noExplicitAny (14) — real type debt

**Headline:** Each `any` defeats the type checker for that subtree. Removing it requires knowing the actual shape — sometimes a 1-line zod schema, sometimes a 50-line type extraction.

**Suggested approach:** Fix as touched — when a developer modifies a file with `any`, replace with the real type as part of that change.

**Occurrences:**

- `scripts/tars-worker-simulator.ts`: L71
- `tars-worker/src/openaiStrictSchema.ts`: L11, L21, L22
- `tars-worker/src/zodToJsonSchema.ts`: L5, L20, L21
- `workflows/brief-lib/brief-store.ts`: L49, L107
- `workflows/lib/audit.ts`: L33, L123, L196, L201
- `workflows/lib/worker-dispatch.ts`: L68

### useExhaustiveDependencies (7) — potential bug surface

**Headline:** Missing deps in useEffect/useCallback/useMemo can mask stale closures — a real correctness gap.

**Suggested approach:** Investigate each. Either add the dep or refactor to remove the implicit closure dependency.

**Occurrences:**

- `app/chat/page.tsx`: L402
- `app/inbox/page.tsx`: L336
- `components/overlays/overlay-container.tsx`: L158, L318
- `components/tars/dashboard-home.tsx`: L288
- `components/tars/mobile-nav.tsx`: L95
- `hooks/use-notifications.ts`: L87

### noNonNullAssertion (16) — safety surface

**Headline:** Each `!` is a runtime assertion the invariant holds. If the invariant is real, refactor to a narrowing check that proves it. If it doesn't hold, this is a latent NPE.

**Suggested approach:** Per-site triage. Replace with explicit null checks where the invariant is not obvious from the call chain.

**Occurrences:**

- `app/api/chat/route.ts`: L117, L182, L306, L324
- `app/inbox/__tests__/escalations.test.ts`: L99, L113
- `app/pr-runs/[runId]/page.tsx`: L68
- `app/settings/page.tsx`: L180
- `tars-worker/test/integration/no-op-roundtrip.test.ts`: L92
- `tars-worker/test/unit/dispatch.test.ts`: L16
- `workflows/__tests__/brief-integration.test.ts`: L120, L124, L134, L135, L136, L137

### useAwait (12) — async without await

**Headline:** Function is marked `async` but never awaits. Two real meanings: (a) the function should be sync (just drop `async`), or (b) there's a missing await on a real Promise inside — which would be a real bug.

**Suggested approach:** Per-site investigation. Read the body before deciding.

**Occurrences:**

- `app/api/inbox/sse/route.ts`: L10
- `app/api/slack/events/__tests__/route.test.ts`: L133, L172, L206, L238
- `app/api/webhooks/github/__tests__/github-webhook.test.ts`: L286
- `app/settings/actions.ts`: L36, L59
- `components/pr-runs/disagreement-panel.tsx`: L180
- `lib/notifications/index.ts`: L36
- `tars-worker/src/heartbeat.ts`: L24
- `tars-worker/src/queue.ts`: L11

### noExcessiveCognitiveComplexity (33) — refactor candidates

**Headline:** Complexity hot-spots. Each finding is a function whose cognitive complexity exceeds the configured threshold of 15. Removing these is a real refactor — split into helpers, hoist sub-stages, drop redundant nesting. Not a mechanical sweep.

**Suggested approach:** Refactor in deliberate slices. Start with the worst offender (`app/api/chat/route.ts` line 126, complexity 103) — that one function alone dwarfs the threshold by a factor of seven.

**Occurrences:**

- `app/api/chat/route.ts`: L35, L126
- `app/api/linear/webhook/route.ts`: L55, L159
- `app/api/slack/events/route.ts`: L78
- `app/api/tars/dashboard/activity/route.ts`: L8
- `app/api/tars/pr-review/disagreement-action/route.ts`: L131
- `app/api/tars/pr-runs/route.ts`: L16
- `app/api/webhooks/github/route.ts`: L129
- `app/chat/page.tsx`: L461
- `app/pr-runs/page.tsx`: L119
- `components/pr-runs/disagreement-panel.tsx`: L183
- `components/pr-runs/findings-summary.tsx`: L60
- `components/pr-runs/json-tree.tsx`: L13
- `components/tars/brief-reply-form.tsx`: L128
- `components/tars/dashboard-home.tsx`: L262
- `components/tars/markdown.tsx`: L101
- `lib/tars/brief/schema.ts`: L158
- `lib/tars/chat-runner.ts`: L71
- `tars-worker/src/handlers/claude-brief-compose.ts`: L103, L217, L237
- `tars-worker/src/handlers/claude-fix-apply.ts`: L24
- `tars-worker/src/handlers/claude-review.ts`: L57
- `tars-worker/src/openaiStrictSchema.ts`: L6
- `tars-worker/src/zodToJsonSchema.ts`: L4
- `workflows/brief-lib/graph-context.ts`: L215
- `workflows/brief-lib/repo-activity.ts`: L149
- `workflows/brief.ts`: L90
- `workflows/lib/gh.ts`: L118
- `workflows/lib/policy.ts`: L73
- `workflows/pr-review.ts`: L194, L282

### noArrayIndexKey (10) — React stable-key gap

**Headline:** Using array index as React key causes incorrect re-render behaviour when the list reorders or items are inserted/removed.

**Suggested approach:** Source stable IDs from data. Some lists may legitimately have no stable ID (e.g., pure presentational), in which case the warning is acceptable but worth a comment.

**Occurrences:**

- `app/chat/page.tsx`: L204
- `app/pr-runs/page.tsx`: L319, L321
- `app/webhooks/page.tsx`: L307, L310
- `components/overlays/workflow-issues-overlay.tsx`: L189
- `components/pr-runs/disagreement-panel.tsx`: L63
- `components/pr-runs/findings-summary.tsx`: L113
- `components/tars/dashboard-home.tsx`: L493
- `components/tars/markdown.tsx`: L286

### noNestedTernary (24) — readability

**Headline:** Deep ternaries are hard to read at a glance. Common fix: extract a small helper, or convert to an if/else cascade.

**Suggested approach:** Extract per-instance during normal touches to those files.

**Occurrences:**

- `app/api/chat/route.ts`: L252
- `app/api/tars/dashboard/stats/route.ts`: L11
- `app/audit/page.tsx`: L369
- `app/briefs/[id]/page.tsx`: L90
- `app/chat/page.tsx`: L275
- `app/inbox/page.tsx`: L467
- `app/pr-runs/page.tsx`: L286, L327
- `app/webhooks/page.tsx`: L316
- `components/pr-runs/audit-timeline.tsx`: L87
- `components/tars/dashboard-home.tsx`: L226, L237, L296, L298, L345, L357, L412, L414, L497
- `components/tars/markdown.tsx`: L169
- `lib/tars/brief/schema.ts`: L166, L180
- `scripts/tars-worker-simulator.ts`: L152
- `tars-worker/src/zodToJsonSchema.ts`: L58

### noDelete (5) — semantics

**Headline:** `delete obj.x` is observably different from `obj.x = undefined` (presence of key, enumeration order, hidden-class transitions). Whether that difference matters here is per-site.

**Suggested approach:** Per-site investigation. Replace with assignment to undefined unless the delete is load-bearing.

**Occurrences:**

- `tars-worker/src/handlers/codex-fix-validate.ts`: L29, L30
- `tars-worker/src/handlers/codex-review.ts`: L38, L39
- `tars-worker/src/openaiStrictSchema.ts`: L15

### noLabelWithoutControl (2) — a11y

**Headline:** <label> must wrap or be associated (via htmlFor) with a form control. Screen readers depend on this association.

**Suggested approach:** Add htmlFor + matching id, or restructure to wrap the input.

**Occurrences:**

- `app/settings/page.tsx`: L355, L370

### useSemanticElements (1) — a11y

**Headline:** An element with an ARIA role has a semantic HTML equivalent; use the native element instead.

**Suggested approach:** Replace `<div role="button">` with `<button>`, etc.

**Occurrences:**

- `components/tars/notification-permission-banner.tsx`: L46

### useValidAriaRole (1) — a11y

**Headline:** ARIA role value is not one of the documented WAI-ARIA roles.

**Suggested approach:** Pick a valid role from the WAI-ARIA spec, or drop the role attribute and rely on semantic HTML.

**Occurrences:**

- `app/chat/page.tsx`: L754

### noForEach (2) — iteration style

**Headline:** Prefer for-of for side-effecting iteration; .forEach() is harder to early-exit and harder to debug step-through.

**Suggested approach:** Replace with for-of loop.

**Occurrences:**

- `components/tars/markdown.tsx`: L256, L265

### noNestedComponentDefinitions (2) — React render bug

**Headline:** Defining a component inside another component creates a new component identity on every parent render — defeats memoisation and causes children to remount.

**Suggested approach:** Hoist to module scope.

**Occurrences:**

- `app/audit/page.tsx`: L145
- `app/pr-runs/page.tsx`: L167

### noNamespaceImport (1) — bundle size

**Headline:** `import * as X from "..."` defeats tree-shaking; named imports are smaller and clearer.

**Suggested approach:** Convert to named imports.

**Occurrences:**

- `tars-worker/src/db.ts`: L3

### useDefaultSwitchClause (1) — exhaustiveness

**Headline:** Switch statement is missing a `default:` clause.

**Suggested approach:** Add an explicit default — even if it's `throw new Error(...)` for unreachable union exhaustiveness.

**Occurrences:**

- `app/api/tars/pr-review/disagreement-action/route.ts`: L238

### useFilenamingConvention (2) — naming

**Headline:** File names should follow kebab-case (configured convention).

**Suggested approach:** Rename file + update imports. Coordinate with anything that references the path.

**Occurrences:**

- `tars-worker/src/openaiStrictSchema.ts`: L0
- `tars-worker/src/zodToJsonSchema.ts`: L0

### useForOf (1) — iteration style

**Headline:** Prefer for-of to a manual index loop where the index isn't used independently.

**Suggested approach:** Convert to for-of.

**Occurrences:**

- `tars-worker/src/handlers/claude-brief-compose.ts`: L241

### noEvolvingTypes (3) — TS inference

**Headline:** Variable is initialised empty and its type "evolves" based on later assignments. Explicit typing makes intent clear.

**Suggested approach:** Add explicit type annotation at declaration.

**Occurrences:**

- `app/api/tars/pr-runs/route.ts`: L21
- `app/api/tars/webhooks/route.ts`: L20
- `app/audit/actions.ts`: L37

### noShadowRestrictedNames (1) — shadowing

**Headline:** Identifier shadows a built-in (e.g., `arguments`, `eval`, `undefined`). Confusing and sometimes a real bug.

**Suggested approach:** Rename the identifier.

**Occurrences:**

- `app/audit/actions.ts`: L125

## How to pick up

When working on any file in this ledger, fix the lint findings in that file as part of the same change. Update this ledger by removing fixed entries. When the file count drops to zero, delete the ledger.

To regenerate after fixes: `pnpm exec biome check --reporter=json --max-diagnostics=500 > /tmp/biome.json` and re-run the ledger generator (`scripts/generate-lint-debt.py`, not committed).

