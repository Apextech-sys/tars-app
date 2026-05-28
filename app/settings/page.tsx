"use client";

import {
  AlertCircle,
  CheckCircle2,
  Info,
  Lock,
  RefreshCw,
  Save,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { NotificationsSettingsSection } from "@/components/tars/notifications-settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  loadModelSettings,
  loadProjectsYaml,
  type ProjectsMap,
  saveKillSwitches,
  saveModelSettings,
  saveProjectsYaml,
} from "./actions";

const CHAT_MODELS = [
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "gpt-4o", label: "GPT-4o" },
];

const CODE_REVIEW_MODELS = [
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "gpt-5.5", label: "GPT-5.5" },
];

// ── Section wrapper ───────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b p-4 md:p-5">
        <h2 className="font-semibold text-base">{title}</h2>
        <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

// ── YAML editor section ───────────────────────────────────────

function YamlEditorSection() {
  const [raw, setRaw] = useState("");
  const [original, setOriginal] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isDirty = raw !== original;

  useEffect(() => {
    loadProjectsYaml().then(({ raw: r }) => {
      setRaw(r);
      setOriginal(r);
    });
  }, []);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveProjectsYaml(raw);
      if (result.ok) {
        setOriginal(raw);
        toast.success("Policy saved");
      } else {
        setError(result.error);
        toast.error("Save failed");
      }
    });
  };

  return (
    <Section
      description="YAML source for /home/shaun/.tars-state/knowledge/projects.yaml. Edits auto-invalidate the policy cache."
      title="Project policies"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-muted-foreground text-xs">
          <Lock className="size-3.5 shrink-0 text-yellow-500" />
          <span>
            protect_mode is <strong>retired</strong>. All{" "}
            <code className="text-xs">auto_review: true</code> repos (including
            Konverge / Reflex-Connect) are reviewed; nothing is written
            externally until you approve from the run detail page.
          </span>
        </div>

        <textarea
          className="min-h-[200px] w-full resize-y rounded-md border bg-background px-3 py-2.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring md:min-h-[480px]"
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          style={{ fontSize: "16px" }}
          value={raw}
        />

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button disabled={!isDirty || isPending} onClick={save} size="sm">
            {isPending ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {isDirty ? "Save changes" : "Saved"}
          </Button>
          {isDirty && (
            <span className="text-xs text-yellow-600 dark:text-yellow-400">
              Unsaved changes
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}

// ── Kill switches section ─────────────────────────────────────

function KillSwitchesSection() {
  const [parsed, setParsed] = useState<ProjectsMap>({});
  const [pending, setPending] = useState<
    Record<string, { auto_review?: boolean; auto_fix?: boolean }>
  >({});
  const [isPending, startTransition] = useTransition();
  const hasPending = Object.keys(pending).length > 0;

  useEffect(() => {
    loadProjectsYaml().then(({ parsed: p }) => {
      setParsed(p);
    });
  }, []);

  const toggle = (
    key: string,
    field: "auto_review" | "auto_fix",
    current: boolean
  ) => {
    setPending((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [field]: !current },
    }));
  };

  const effectiveVal = (
    key: string,
    field: "auto_review" | "auto_fix"
  ): boolean => {
    if (pending[key]?.[field] !== undefined) {
      return pending[key][field]!;
    }
    return (parsed[key]?.[field] as boolean | undefined) ?? false;
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveKillSwitches(pending);
      if (result.ok) {
        // Merge pending into parsed
        setParsed((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(pending)) {
            next[k] = { ...(next[k] ?? {}), ...v };
          }
          return next;
        });
        setPending({});
        toast.success("Kill switches saved");
      } else {
        toast.error(result.error);
      }
    });
  };

  const projects = Object.entries(parsed);

  return (
    <Section
      description="Toggle auto-review and auto-fix per project. Changes are previewed before saving."
      title="Kill switches"
    >
      <div className="space-y-4">
        {projects.length === 0 ? (
          <p className="text-muted-foreground text-sm">No projects found.</p>
        ) : (
          <div className="space-y-2">
            {projects.map(([key]) => {
              const autoReview = effectiveVal(key, "auto_review");
              const autoFix = effectiveVal(key, "auto_fix");
              const changed =
                pending[key]?.auto_review !== undefined ||
                pending[key]?.auto_fix !== undefined;

              return (
                <div
                  className={cn(
                    "flex items-center justify-between gap-4 rounded-md border px-4 py-3",
                    changed &&
                      "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20"
                  )}
                  key={key}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium font-mono text-sm">
                      {key}
                    </span>
                    {changed && (
                      <Badge className="text-xs" variant="warning">
                        unsaved
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm">
                      <input
                        checked={autoReview}
                        className="size-5 cursor-pointer accent-primary"
                        onChange={() => toggle(key, "auto_review", autoReview)}
                        type="checkbox"
                      />
                      Auto-review
                    </label>

                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm">
                      <input
                        checked={autoFix}
                        className="size-5 cursor-pointer accent-primary"
                        onChange={() => toggle(key, "auto_fix", autoFix)}
                        type="checkbox"
                      />
                      Auto-fix
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasPending && (
          <div className="flex items-center gap-3 rounded-md border border-yellow-400 bg-yellow-50 px-4 py-3 dark:bg-yellow-950/20">
            <Info className="size-4 shrink-0 text-yellow-600" />
            <p className="flex-1 text-sm text-yellow-700 dark:text-yellow-300">
              {Object.keys(pending).length} project(s) have pending changes.
            </p>
            <Button disabled={isPending} onClick={save} size="sm">
              {isPending ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              Save all
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

// ── Model picker section ──────────────────────────────────────

function ModelPickerSection() {
  const [chatModel, setChatModel] = useState("claude-sonnet-4-5");
  const [codeReviewModel, setCodeReviewModel] = useState("claude-sonnet-4-5");
  const [original, setOriginal] = useState({
    chatModel: "claude-sonnet-4-5",
    codeReviewModel: "claude-sonnet-4-5",
  });
  const [isPending, startTransition] = useTransition();
  const isDirty =
    chatModel !== original.chatModel ||
    codeReviewModel !== original.codeReviewModel;

  useEffect(() => {
    loadModelSettings().then((s) => {
      setChatModel(s.chatModel);
      setCodeReviewModel(s.codeReviewModel);
      setOriginal(s);
    });
  }, []);

  const save = () => {
    startTransition(async () => {
      await saveModelSettings({ chatModel, codeReviewModel });
      setOriginal({ chatModel, codeReviewModel });
      toast.success("Model settings saved");
    });
  };

  return (
    <Section
      description="Global defaults for chat and code-review models. Stored in app_settings table."
      title="Model picker"
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="font-medium text-sm">Chat model</label>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            onChange={(e) => setChatModel(e.target.value)}
            value={chatModel}
          >
            {CHAT_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="font-medium text-sm">Code-review model</label>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            onChange={(e) => setCodeReviewModel(e.target.value)}
            value={codeReviewModel}
          >
            {CODE_REVIEW_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <Button disabled={!isDirty || isPending} onClick={save} size="sm">
          {isPending ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          {isDirty ? "Save changes" : "Saved"}
        </Button>
      </div>
    </Section>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 md:space-y-8 md:py-8">
        <div>
          <h1 className="font-bold text-2xl">Settings</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Project policies, kill switches, and model configuration.
          </p>
        </div>

        <YamlEditorSection />
        <KillSwitchesSection />
        <ModelPickerSection />
        <NotificationsSettingsSection />
      </div>
    </div>
  );
}
