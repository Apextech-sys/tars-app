"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Lock,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type ProjectPolicy,
  type ProjectsMap,
  loadModelSettings,
  loadProjectsYaml,
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
      <div className="p-5 border-b">
        <h2 className="font-semibold text-base">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="p-5">{children}</div>
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
      title="Project policies"
      description="YAML source for /home/shaun/.tars-state/knowledge/projects.yaml. Edits auto-invalidate the policy cache."
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border bg-muted/50 px-3 py-2">
          <Lock className="size-3.5 text-yellow-500 shrink-0" />
          <span>
            <strong>konverge.protect_mode</strong> is hardcoded in{" "}
            <code className="text-xs">workflows/lib/konverge-guard.ts</code> and
            cannot be changed via this UI.
          </span>
        </div>

        <textarea
          className="w-full rounded-md border bg-background font-mono text-xs px-3 py-2.5 min-h-[480px] focus:outline-none focus:ring-2 focus:ring-ring resize-y"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
        />

        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            onClick={save}
            disabled={!isDirty || isPending}
            size="sm"
          >
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
    current: boolean,
  ) => {
    setPending((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [field]: !current },
    }));
  };

  const effectiveVal = (
    key: string,
    field: "auto_review" | "auto_fix",
  ): boolean => {
    if (pending[key]?.[field] !== undefined) return pending[key][field]!;
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
      title="Kill switches"
      description="Toggle auto-review and auto-fix per project. Changes are previewed before saving."
    >
      <div className="space-y-4">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects found.</p>
        ) : (
          <div className="space-y-2">
            {projects.map(([key]) => {
              const autoReview = effectiveVal(key, "auto_review");
              const autoFix = effectiveVal(key, "auto_fix");
              const isKonverge = key === "konverge";
              const changed =
                pending[key]?.auto_review !== undefined ||
                pending[key]?.auto_fix !== undefined;

              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center justify-between gap-4 rounded-md border px-4 py-3",
                    changed && "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm font-medium truncate">
                      {key}
                    </span>
                    {changed && (
                      <Badge variant="warning" className="text-xs">
                        unsaved
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={autoReview}
                              disabled={isKonverge}
                              onChange={() =>
                                toggle(key, "auto_review", autoReview)
                              }
                              className="size-4 accent-primary"
                            />
                            Auto-review
                          </label>
                        </TooltipTrigger>
                        {isKonverge && (
                          <TooltipContent>
                            Konverge is read-only — protect_mode active
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={autoFix}
                              disabled={isKonverge}
                              onChange={() =>
                                toggle(key, "auto_fix", autoFix)
                              }
                              className="size-4 accent-primary"
                            />
                            Auto-fix
                          </label>
                        </TooltipTrigger>
                        {isKonverge && (
                          <TooltipContent>
                            Konverge is read-only — protect_mode active
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasPending && (
          <div className="flex items-center gap-3 rounded-md border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 px-4 py-3">
            <Info className="size-4 text-yellow-600 shrink-0" />
            <p className="text-sm text-yellow-700 dark:text-yellow-300 flex-1">
              {Object.keys(pending).length} project(s) have pending changes.
            </p>
            <Button size="sm" onClick={save} disabled={isPending}>
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
      title="Model picker"
      description="Global defaults for chat and code-review models. Stored in app_settings table."
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Chat model</label>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
          >
            {CHAT_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Code-review model</label>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={codeReviewModel}
            onChange={(e) => setCodeReviewModel(e.target.value)}
          >
            {CODE_REVIEW_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={save} disabled={!isDirty || isPending} size="sm">
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
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Project policies, kill switches, and model configuration.
          </p>
        </div>

        <YamlEditorSection />
        <KillSwitchesSection />
        <ModelPickerSection />
      </div>
    </div>
  );
}
