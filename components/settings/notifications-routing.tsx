"use client";

import { Hash, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { NotificationsSettingsSection } from "@/components/tars/notifications-settings-section";
import { Button } from "@/components/ui/button";

const LEADING_HASH_RE = /^#/;

interface RoutingPayload {
  slackAllowedChannels: string[];
  slackBotUserId: string | null;
  linearBotUserId: string | null;
}

function ChannelChips({
  channels,
  onRemove,
}: {
  channels: string[];
  onRemove: (channel: string) => void;
}) {
  if (channels.length === 0) {
    return (
      <span className="text-muted-foreground/70 text-xs">
        No channels configured — escalations post nowhere via Slack yet.
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {channels.map((c) => (
        <span
          className="flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
          key={c}
        >
          <Hash className="size-3 text-muted-foreground" />
          {c}
          <button
            aria-label={`Remove ${c}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onRemove(c)}
            type="button"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function LabelledField({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="font-medium text-sm">{label}</span>
      <input
        className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        value={value}
      />
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

function RoutingEditor() {
  const [channels, setChannels] = useState<string[]>([]);
  const [channelDraft, setChannelDraft] = useState("");
  const [slackBotUserId, setSlackBotUserId] = useState("");
  const [linearBotUserId, setLinearBotUserId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [isSaving, startSaving] = useTransition();

  useEffect(() => {
    let active = true;
    fetch("/api/settings/routing")
      .then((r) => r.json())
      .then((d: RoutingPayload) => {
        if (!active) {
          return;
        }
        setChannels(d.slackAllowedChannels ?? []);
        setSlackBotUserId(d.slackBotUserId ?? "");
        setLinearBotUserId(d.linearBotUserId ?? "");
        setLoaded(true);
      })
      .catch(() => {
        if (active) {
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const addChannel = () => {
    const next = channelDraft.trim().replace(LEADING_HASH_RE, "");
    if (next.length === 0 || channels.includes(next)) {
      setChannelDraft("");
      return;
    }
    setChannels((prev) => [...prev, next]);
    setChannelDraft("");
  };

  const save = () => {
    startSaving(async () => {
      try {
        const res = await fetch("/api/settings/routing", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slackAllowedChannels: channels,
            slackBotUserId: slackBotUserId.trim() || null,
            linearBotUserId: linearBotUserId.trim() || null,
          }),
        });
        if (!res.ok) {
          throw new Error("save failed");
        }
        toast.success("Routing saved");
      } catch {
        toast.error("Save failed");
      }
    });
  };

  if (!loaded) {
    return <div className="h-24 animate-pulse rounded-md border bg-muted/30" />;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="font-medium text-sm">Slack allowed channels</span>
        <ChannelChips
          channels={channels}
          onRemove={(c) => setChannels((prev) => prev.filter((x) => x !== c))}
        />
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            onChange={(e) => setChannelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addChannel();
              }
            }}
            placeholder="add a channel (e.g. tars-alerts)"
            value={channelDraft}
          />
          <Button
            onClick={addChannel}
            size="sm"
            type="button"
            variant="outline"
          >
            Add
          </Button>
        </div>
      </div>

      <LabelledField
        hint="The bot user that posts escalations; gates where alerts originate."
        label="Slack bot user id"
        onChange={setSlackBotUserId}
        placeholder="U0XXXXXXX"
        value={slackBotUserId}
      />
      <LabelledField
        hint="The Linear bot user TARS comments as on adjudication."
        label="Linear bot user id"
        onChange={setLinearBotUserId}
        placeholder="not configured"
        value={linearBotUserId}
      />

      <Button
        className="min-h-[44px]"
        disabled={isSaving}
        onClick={save}
        size="sm"
      >
        {isSaving ? (
          <RefreshCw className="size-3.5 animate-spin" />
        ) : (
          <Save className="size-3.5" />
        )}
        Save routing
      </Button>
    </div>
  );
}

export function NotificationsRoutingSection() {
  return (
    <div className="space-y-4">
      <NotificationsSettingsSection />
      <details className="group rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-1 p-4 font-medium text-sm">
          <span className="transition-transform group-open:rotate-90">›</span>
          Channel routing (advanced)
        </summary>
        <div className="border-t p-4">
          <p className="mb-4 text-muted-foreground text-xs">
            Where escalations get posted. These keys are unset by default — set
            them to enable Slack/Linear delivery.
          </p>
          <RoutingEditor />
        </div>
      </details>
    </div>
  );
}
