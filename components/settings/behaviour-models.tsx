"use client";

import { Bot, MessageSquare, RefreshCw, Save } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { loadModelSettings, saveModelSettings } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";

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

function labelFor(
  options: { value: string; label: string }[],
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

function ModelTile({
  icon: Icon,
  title,
  description,
  options,
  value,
  onChange,
}: {
  icon: typeof Bot;
  title: string;
  description: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
          <Icon className="size-4" /> {title}
        </div>
        <span className="rounded-full border border-[#00d4a0]/30 bg-[#00d4a0]/10 px-2 py-0.5 text-[#00d4a0] text-xs">
          {labelFor(options, value)}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">{description}</p>
      <select
        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        onChange={(e) => onChange(e.target.value)}
        value={value}
      >
        {options.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function BehaviourModelsSection() {
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
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <ModelTile
          description="Powers the conversational TARS assistant."
          icon={MessageSquare}
          onChange={setChatModel}
          options={CHAT_MODELS}
          title="Chat model"
          value={chatModel}
        />
        <ModelTile
          description="Runs the dual-AI PR review engine."
          icon={Bot}
          onChange={setCodeReviewModel}
          options={CODE_REVIEW_MODELS}
          title="Code-review model"
          value={codeReviewModel}
        />
      </div>
      <Button
        className="min-h-[44px]"
        disabled={!isDirty || isPending}
        onClick={save}
        size="sm"
      >
        {isPending ? (
          <RefreshCw className="size-3.5 animate-spin" />
        ) : (
          <Save className="size-3.5" />
        )}
        {isDirty ? "Save changes" : "Saved"}
      </Button>
    </div>
  );
}
