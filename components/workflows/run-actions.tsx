"use client";

import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

type ApprovalAction = "approve" | "reject";

export function ApprovalGate({
  runId,
  findingsCount,
}: {
  runId: string;
  findingsCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<ApprovalAction | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (action: ApprovalAction) => {
    setBusy(action);
    setError(null);
    fetch("/api/tars/pr-review/approval-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, action, reason: reason || undefined }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? `Request failed (${r.status})`);
        }
        router.refresh();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4">
      <div className="font-medium text-sky-200 text-sm">
        Approval gate · {findingsCount} agreed finding
        {findingsCount === 1 ? "" : "s"}
      </div>
      <p className="mt-1 text-sky-200/70 text-xs">
        Both reviewers agreed. Approve to authorize the fix stage, or reject to
        close the run.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#00d4a0] px-4 py-2 font-medium text-black text-sm transition-colors hover:bg-[#00d4a0]/90 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => submit("approve")}
          type="button"
        >
          {busy === "approve" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Approve
        </button>
        <button
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-rose-500/40 px-4 py-2 font-medium text-rose-300 text-sm transition-colors hover:bg-rose-500/10 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => {
            if (showReason) {
              submit("reject");
            } else {
              setShowReason(true);
            }
          }}
          type="button"
        >
          {busy === "reject" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <X className="size-4" />
          )}
          {showReason ? "Confirm reject" : "Reject"}
        </button>
      </div>
      {showReason ? (
        <textarea
          className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm"
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional reason for rejecting…"
          rows={2}
          value={reason}
        />
      ) : null}
      {error ? <p className="mt-2 text-rose-400 text-xs">{error}</p> : null}
    </div>
  );
}

type AdjudicateAction =
  | "post-codex"
  | "post-claude"
  | "post-merged"
  | "dismiss";

const ADJUDICATE_OPTIONS: { action: AdjudicateAction; label: string }[] = [
  { action: "post-merged", label: "Post merged set" },
  { action: "post-codex", label: "Post Codex only" },
  { action: "post-claude", label: "Post Claude only" },
  { action: "dismiss", label: "Dismiss" },
];

export function DisagreementGate({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<AdjudicateAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (action: AdjudicateAction) => {
    setBusy(action);
    setError(null);
    fetch("/api/tars/pr-review/disagreement-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, action }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? `Request failed (${r.status})`);
        }
        router.refresh();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="rounded-xl border border-purple-500/40 bg-purple-500/10 p-4">
      <div className="font-medium text-purple-200 text-sm">
        Adjudicate disagreement
      </div>
      <p className="mt-1 text-purple-200/70 text-xs">
        Codex and Claude diverged. Choose which findings to post to the PR, or
        dismiss the run.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ADJUDICATE_OPTIONS.map((opt) => (
          <button
            className={cn(
              "inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-2 font-medium text-sm transition-colors disabled:opacity-50",
              opt.action === "dismiss"
                ? "border-zinc-600 text-muted-foreground hover:bg-muted"
                : "border-purple-500/40 text-purple-200 hover:bg-purple-500/15"
            )}
            disabled={busy !== null}
            key={opt.action}
            onClick={() => submit(opt.action)}
            type="button"
          >
            {busy === opt.action ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {opt.label}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-rose-400 text-xs">{error}</p> : null}
    </div>
  );
}
