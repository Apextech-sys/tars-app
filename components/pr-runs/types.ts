// Shared types for PR run detail page and components

export type RunStatus =
  | "started"
  | "completed"
  | "skipped-no-findings"
  | "skipped-policy"
  | "blocked-konverge"
  | "disagreed"
  | "error";

export interface PolicyConfig {
  autoFix?: boolean;
  dryRun?: boolean;
  protectedMode?: boolean | string | { enabled?: boolean; pattern?: string };
  agreementThreshold?: number;
}

export interface PrRun {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  policy: PolicyConfig | null;
  status: RunStatus;
  findingsCount: number;
  reviewCommentUrl: string | null;
  error: string | null;
  disagreedPayload: unknown;
  adjudicationAction: string | null;
  adjudicationActionAt: string | null;
  createdAt: string;
  updatedAt: string;
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
