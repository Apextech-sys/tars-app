/**
 * Static catalog of TARS's DEFINED durable WDK workflows.
 *
 * There is NO table that lists workflow definitions — the only source of truth
 * is the WDK source files in `workflows/*.ts`. (The @xyflow `workflows` table is
 * the user visual-builder World and is empty/irrelevant here.) This curated
 * registry lets brief / pr-fix / retention-archive / chat surface as first-class
 * fleet cards even when they have produced zero runs, so their idleness is
 * VISIBLE rather than silently absent.
 *
 * `auditWorkflow` is the value written into `audit_log.workflow` by the running
 * workflow (only "pr-review" emits today). It is how `lib/tars/workflows.ts`
 * joins live run aggregates back onto each registry entry.
 */

export type WorkflowTrigger = "webhook" | "schedule" | "manual" | "chain";

export interface WorkflowDefinition {
  /** URL key + stable identifier, e.g. "pr-review". */
  key: string;
  /** Human label. */
  label: string;
  /** One-line description of what the workflow does. */
  description: string;
  /** lucide-react icon name (resolved on the client). */
  icon: string;
  /** How the workflow is kicked off. */
  trigger: WorkflowTrigger;
  /** Human caption for the trigger (e.g. "GitHub PR webhook"). */
  triggerLabel: string;
  /** Source file the definition lives in. */
  sourceFile: string;
  /**
   * Documented pipeline, rendered as a horizontal step-pill strip. Curated from
   * each workflow's file-header pipeline doc.
   */
  steps: string[];
  /** audit_log.workflow value this definition emits (null = not yet wired). */
  auditWorkflow: string | null;
}

export const WORKFLOW_REGISTRY: WorkflowDefinition[] = [
  {
    key: "pr-review",
    label: "PR Review",
    description:
      "Dual-AI (Claude + Codex) review with an iterative debate, triage, blast-radius and a human approval gate.",
    icon: "GitPullRequest",
    trigger: "webhook",
    triggerLabel: "GitHub PR webhook",
    sourceFile: "workflows/pr-review.ts",
    steps: [
      "routing",
      "fetch-pr",
      "debate",
      "triage",
      "blast-radius",
      "approval-gate",
      "complete",
    ],
    auditWorkflow: "pr-review",
  },
  {
    key: "pr-fix",
    label: "PR Fix",
    description:
      "Post-approval fix stage: re-validate findings, fix within blast radius, run a deterministic test gate, open a fix PR.",
    icon: "Wrench",
    trigger: "chain",
    triggerLabel: "Chained on approval",
    sourceFile: "workflows/pr-fix.ts",
    steps: [
      "load-run",
      "fixing",
      "re-validate",
      "test-gate",
      "fix-in-review",
      "done",
    ],
    auditWorkflow: "pr-fix",
  },
  {
    key: "brief",
    label: "Briefings",
    description:
      "Twice-daily state-of-the-world briefing: graph + projects + audit + GitHub context composed into a report.",
    icon: "BookOpen",
    trigger: "schedule",
    triggerLabel: "Twice daily (systemd timer)",
    sourceFile: "workflows/brief.ts",
    steps: [
      "context-graph",
      "context-projects",
      "context-audit",
      "context-github",
      "compose",
      "finalize",
    ],
    auditWorkflow: "brief",
  },
  {
    key: "retention-archive",
    label: "Retention Archive",
    description:
      "Daily sweep that slims pr_review_runs older than 30 days down to a summary and prunes their audit trail.",
    icon: "Archive",
    trigger: "schedule",
    triggerLabel: "Daily 03:00 UTC (systemd timer)",
    sourceFile: "workflows/retention-archive.ts",
    steps: ["scan", "batch-archive", "prune-audit", "complete"],
    auditWorkflow: "retention",
  },
  {
    key: "chat",
    label: "Chat Agent",
    description:
      "The durable conversational agent loop backing the TARS chat surface.",
    icon: "MessageSquare",
    trigger: "manual",
    triggerLabel: "Operator chat",
    sourceFile: "workflows/__tests__/chat",
    steps: ["receive", "reason", "tool-call", "respond"],
    auditWorkflow: "chat",
  },
];

export function getWorkflowRegistry(): WorkflowDefinition[] {
  return WORKFLOW_REGISTRY;
}

export function getWorkflowDefinition(
  key: string
): WorkflowDefinition | undefined {
  return WORKFLOW_REGISTRY.find((w) => w.key === key);
}
