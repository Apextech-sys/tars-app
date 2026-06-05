/**
 * Resolve a webhook delivery to the PR-review run it actually started.
 *
 * THE LINKAGE PROBLEM
 * -------------------
 * `webhook_events.triggered_run` stores the WDK execution id (`wrun_…`) that
 * `start()` returns to the GitHub webhook handler. The PR-runs detail route,
 * however, keys on `pr_review_runs.run_id`, which is the workflow's OWN id of
 * the form `prrev_<owner>_<repo>_<prNumber>_<Date.now()>` (see
 * workflows/pr-review.ts). The two ids are unrelated, so a link built from
 * `triggered_run` (`/pr-runs/<wrun_…>`) always 404s.
 *
 * THE CORRELATION
 * ---------------
 * The trailing integer of a `prrev_` run_id is `Date.now()` captured at
 * workflow entry — the same instant the webhook handler receives `start()`
 * back and writes the event row. Empirically (validated against production
 * deliveries) the genuine run's embedded timestamp lands within a few hundred
 * milliseconds of the event's `created_at`, with occasional ~8 s handoff lag;
 * unrelated runs (re-deliveries of the same PR) are tens of seconds away. So
 * we correlate on (owner, repo, prNumber) + nearest embedded timestamp within
 * a tight window, and only return a match when we are confident.
 *
 * This is a READ-TIME resolution: it fixes existing AND future deliveries with
 * no schema change and no coupling to the webhook→workflow forward path. When
 * no confident match exists (the run never materialised, or is outside the
 * window) we return `null` and the UI renders the id as plain text rather than
 * a dead per-run link.
 */

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { prReviewRuns, webhookEvents } from "@/lib/db/tars-schema";

/**
 * Maximum distance (ms) between an event's `created_at` and a candidate run's
 * embedded `Date.now()` for the run to be accepted as the one this delivery
 * triggered. Genuine handoffs are observed up to ~8.5 s; the next-nearest
 * unrelated run (a re-delivery of the same PR) sits at 18 s+, so 15 s cleanly
 * separates real matches from mis-attributions.
 */
const MATCH_WINDOW_MS = 15_000;

/** The trailing `_<digits>` group is the workflow's `Date.now()` at entry. */
const RUN_ID_TS_RE = /_(\d{10,})$/;

/** Minimal shape the resolver needs from a webhook_events row. */
export interface ResolvableEvent {
  id: number;
  repoKey: string;
  prNumber: number | null;
  triggeredRun: string | null;
  createdAt: Date;
}

/** Split a `owner/repo` repo key; returns null if it is not well-formed. */
function splitRepoKey(repoKey: string): { owner: string; repo: string } | null {
  const slash = repoKey.indexOf("/");
  if (slash <= 0 || slash === repoKey.length - 1) {
    return null;
  }
  return { owner: repoKey.slice(0, slash), repo: repoKey.slice(slash + 1) };
}

/** Parse the embedded `Date.now()` ms from a `prrev_…_<ms>` run_id. */
function embeddedTs(runId: string): number | null {
  const m = RUN_ID_TS_RE.exec(runId);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** A webhook event that has a triggered run + a well-formed repo key. */
type EligibleEvent = ResolvableEvent & { owner: string; repo: string };

/** A `prrev_` run candidate with its embedded `Date.now()` parsed out. */
interface RunCandidate {
  runId: string;
  ts: number;
}

/** Stable bucket key for an (owner, repo, prNumber) tuple. */
function tupleKey(owner: string, repo: string, prNumber: number): string {
  return `${owner}/${repo}#${prNumber}`;
}

/**
 * Filter to events that can be resolved (have a triggered run, a pr number,
 * and a well-formed `owner/repo` key), splitting out owner+repo as we go.
 */
function toEligible(events: ResolvableEvent[]): EligibleEvent[] {
  const out: EligibleEvent[] = [];
  for (const e of events) {
    if (!(e.triggeredRun && e.prNumber !== null)) {
      continue;
    }
    const parts = splitRepoKey(e.repoKey);
    if (parts) {
      out.push({ ...e, owner: parts.owner, repo: parts.repo });
    }
  }
  return out;
}

/**
 * Fetch all candidate runs for the (owner, repo, prNumber) tuples in the batch
 * and bucket them by tuple key, parsing each run_id's embedded timestamp.
 * Runs whose id carries no parseable timestamp are dropped.
 */
async function fetchCandidatesByTuple(
  eligible: EligibleEvent[]
): Promise<Map<string, RunCandidate[]>> {
  const tuples = eligible.map((e) =>
    and(
      eq(prReviewRuns.owner, e.owner),
      eq(prReviewRuns.repo, e.repo),
      eq(prReviewRuns.prNumber, e.prNumber as number)
    )
  );
  const prNumbers = Array.from(
    new Set(eligible.map((e) => e.prNumber as number))
  );

  const rows = await db
    .select({
      runId: prReviewRuns.runId,
      owner: prReviewRuns.owner,
      repo: prReviewRuns.repo,
      prNumber: prReviewRuns.prNumber,
    })
    .from(prReviewRuns)
    // Narrow by prNumber (indexed-friendly) then OR the exact tuples so we
    // never pull runs for an unrelated owner/repo that shares a PR number.
    .where(and(inArray(prReviewRuns.prNumber, prNumbers), or(...tuples)));

  const byTuple = new Map<string, RunCandidate[]>();
  for (const c of rows) {
    const ts = embeddedTs(c.runId);
    if (ts === null) {
      continue;
    }
    const key = tupleKey(c.owner, c.repo, c.prNumber);
    const list = byTuple.get(key);
    if (list) {
      list.push({ runId: c.runId, ts });
    } else {
      byTuple.set(key, [{ runId: c.runId, ts }]);
    }
  }
  return byTuple;
}

/** Pick the candidate nearest to `evMs`, or null if none is within the window. */
function nearestWithinWindow(
  candidates: RunCandidate[],
  evMs: number
): string | null {
  let best: string | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const delta = Math.abs(c.ts - evMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c.runId;
    }
  }
  return bestDelta <= MATCH_WINDOW_MS ? best : null;
}

/**
 * Resolve a batch of webhook events to their `prrev_` run ids in one query.
 *
 * Returns a Map keyed by event id. The value is the resolved `pr_review_runs`
 * `run_id` when a confident match exists, or `null` otherwise (no
 * `triggered_run`, malformed repo key, run never landed, or outside the
 * window). Callers should treat `null` as "render the id as plain text".
 */
export async function resolvePrRunIds(
  events: ResolvableEvent[]
): Promise<Map<number, string | null>> {
  // Seed every event as unresolved; matches overwrite below.
  const result = new Map<number, string | null>(
    events.map((e) => [e.id, null])
  );

  const eligible = toEligible(events);
  if (eligible.length === 0) {
    return result;
  }

  const byTuple = await fetchCandidatesByTuple(eligible);

  for (const e of eligible) {
    const candidates = byTuple.get(
      tupleKey(e.owner, e.repo, e.prNumber as number)
    );
    if (candidates) {
      result.set(e.id, nearestWithinWindow(candidates, e.createdAt.getTime()));
    }
  }

  return result;
}

/** Single-event convenience wrapper around {@link resolvePrRunIds}. */
export async function resolvePrRunId(
  event: ResolvableEvent
): Promise<string | null> {
  const map = await resolvePrRunIds([event]);
  return map.get(event.id) ?? null;
}

/**
 * Reverse of {@link resolvePrRunId}: given a `prrev_` run, find the
 * webhook_events row that triggered it. The pr-runs detail route cannot join on
 * `triggered_run` (it holds the unrelated `wrun_` execution id), so we
 * correlate on (owner/repo via repo_key, prNumber) + the event `created_at`
 * nearest the run_id's embedded `Date.now()`, within the same tight window.
 * Returns the full event row, or null when no confident match exists (the UI
 * then renders no "Triggering webhook" card rather than a wrong one).
 */
export async function resolveWebhookEventForRun(run: {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number | null;
}): Promise<typeof webhookEvents.$inferSelect | null> {
  const ts = embeddedTs(run.runId);
  if (ts === null || run.prNumber === null) {
    return null;
  }
  const repoKey = `${run.owner}/${run.repo}`;
  const rows = await db
    .select()
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.repoKey, repoKey),
        eq(webhookEvents.prNumber, run.prNumber),
        isNotNull(webhookEvents.triggeredRun)
      )
    );
  let best: (typeof rows)[number] | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const e of rows) {
    const delta = Math.abs(e.createdAt.getTime() - ts);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = e;
    }
  }
  return bestDelta <= MATCH_WINDOW_MS ? best : null;
}
