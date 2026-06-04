// Shared types for PR run detail page and components

export type RunStatus =
  | "started"
  | "completed"
  | "skipped-no-findings"
  | "skipped-policy"
  | "blocked-konverge"
  | "disagreed"
  | "pending-approval"
  | "approved"
  | "rejected"
  // Slice 2 (fix stage):
  | "fixing"
  | "fix-in-review"
  | "fix-failed"
  | "done"
  | "error";

export interface PolicyConfig {
  autoFix?: boolean;
  dryRun?: boolean;
  protectedMode?: boolean | string | { enabled?: boolean; pattern?: string };
  agreementThreshold?: number;
  issueTracker?: "linear" | "github" | "none";
  linearTeam?: string | null;
}

/** A finding the two reviewers agreed on, persisted for the approval UI. */
export interface AgreedFinding {
  file?: string;
  line?: number;
  severity?: string;
  category?: string;
  message?: string;
  suggestion?: string;
}

/** One reviewer's position at a given debate round. */
export interface DebateReviewerPosition {
  reviewer: "codex" | "claude";
  summary?: string;
  findings: AgreedFinding[];
  endorsed?: number;
  retracted?: number;
}

/** A single debate round: both reviewers' positions. */
export interface DebateRound {
  round: number;
  codex: DebateReviewerPosition;
  claude: DebateReviewerPosition;
}

/** The full iterative reviewer-debate transcript (Slice 3). */
export interface DebateTranscript {
  rounds: DebateRound[];
  maxRounds: number;
  agreed: AgreedFinding[];
  disputed: AgreedFinding[];
  stopReason: "converged" | "max-rounds" | "no-findings";
}

export interface PrRun {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  prTitle: string | null;
  prAuthor: string | null;
  policy: PolicyConfig | null;
  status: RunStatus;
  findingsCount: number;
  reviewCommentUrl: string | null;
  error: string | null;
  disagreedPayload: unknown;
  adjudicationAction: string | null;
  adjudicationActionAt: string | null;
  debateRounds: DebateTranscript | null;
  agreedFindings: AgreedFinding[] | null;
  linearIssueId: string | null;
  linearIssueIdentifier: string | null;
  linearIssueUrl: string | null;
  approvalAction: string | null;
  approvalActionAt: string | null;
  approvalReason: string | null;
  // Slice 2: fix stage.
  fixStatus: string | null;
  fixBranch: string | null;
  fixPrUrl: string | null;
  fixPrNumber: number | null;
  fixRevalidation: FixRevalidationItem[] | null;
  fixBlastRadius: FixBlastRadius | null;
  fixCoverageRootcause: string | null;
  fixTestGate: FixTestGate | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The deterministic baseline-diff test-gate verdict (Slice 4). The gate runs
 * the suite before + after the fix and a fix is safe iff it adds no regression.
 */
export interface FixTestGate {
  passed: boolean;
  code:
    | "no-regressions"
    | "regressions"
    | "added-test-failed"
    | "after-suite-passed"
    | "after-suite-failed"
    | "tests-inconclusive";
  baselinePassCount: number | null;
  afterPassCount: number | null;
  regressions: string[];
  newlyFailing: string[];
  summary: string;
  reason?: string;
  testCommand: string | null;
}

/** A finding's independent re-validation outcome (stage 7). */
export interface FixRevalidationItem {
  finding?: AgreedFinding;
  kept: boolean;
  reason: string;
}

/** The traced blast radius of the applied fix (stage 8). */
export interface FixBlastRadius {
  summary?: string;
  changedFiles?: string[];
  callers?: string[];
  notes?: string;
}

export interface AuditLogRow {
  id: number;
  runId: string;
  workflow: string;
  step: string;
  status: string;
  owner: string | null;
  repo: string | null;
  prNumber: number | null;
  message: string | null;
  data: unknown;
  createdAt: string;
}

export interface WebhookEventRow {
  id: number;
  eventType: string;
  deliveryId: string | null;
  repoKey: string;
  action: string | null;
  prNumber: number | null;
  prSha: string | null;
  prTitle: string | null;
  senderLogin: string | null;
  rawPayload: unknown;
  triggeredRun: string | null;
  createdAt: string;
}

export interface TarsJobRow {
  id: string;
  kind: string;
  payload: unknown;
  status: string;
  result: unknown;
  errorText: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attempts: number;
  maxAttempts: number;
  workerId: string | null;
}

export interface DisagreementPayload {
  codex?: {
    findings?: FindingItem[];
    summary?: string;
    model?: string;
  };
  claude?: {
    findings?: FindingItem[];
    summary?: string;
    model?: string;
  };
  overlapRatio?: number;
}

export interface FindingItem {
  severity?: "CRITICAL" | "MAJOR" | "MINOR" | string;
  file?: string;
  filePath?: string;
  line?: number | string;
  lineNumber?: number | string;
  suggestion?: string;
  message?: string;
  description?: string;
}

export interface PrRunDetail {
  run: PrRun;
  auditLog: AuditLogRow[];
  webhookEvent: WebhookEventRow | null;
  jobs: TarsJobRow[];
}
