"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface JsonTreeProps {
  data: unknown;
  depth?: number;
  className?: string;
}

function JsonArray({
  value,
  depth,
}: {
  value: unknown[];
  depth: number;
}): ReactElement {
  const [expanded, setExpanded] = useState(depth < 2);

  if (value.length === 0) {
    return <span className="font-mono text-xs text-zinc-400">[]</span>;
  }
  return (
    <span>
      <button
        aria-expanded={expanded}
        className="inline-flex items-center gap-0.5 font-mono text-xs text-zinc-300 hover:text-white"
        onClick={() => setExpanded((e) => !e)}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <span className="text-zinc-400">
          [{value.length} item{value.length === 1 ? "" : "s"}]
        </span>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 space-y-1 border-zinc-700 border-l pl-3">
          {value.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: position is stable for display
            <div className="flex items-start gap-2" key={i}>
              <span className="shrink-0 pt-0.5 font-mono text-xs text-zinc-600">
                {i}:
              </span>
              <JsonValue depth={depth + 1} value={item} />
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function JsonObject({
  value,
  depth,
}: {
  value: Record<string, unknown>;
  depth: number;
}): ReactElement {
  const [expanded, setExpanded] = useState(depth < 2);

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <span className="font-mono text-xs text-zinc-400">{"{}"}</span>;
  }
  return (
    <span>
      <button
        aria-expanded={expanded}
        className="inline-flex items-center gap-0.5 font-mono text-xs text-zinc-300 hover:text-white"
        onClick={() => setExpanded((e) => !e)}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <span className="text-zinc-400">
          {"{"}
          {entries.length} key{entries.length === 1 ? "" : "s"}
          {"}"}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 space-y-1 border-zinc-700 border-l pl-3">
          {entries.map(([key, val]) => (
            <div className="flex flex-wrap items-start gap-2" key={key}>
              <span className="shrink-0 pt-0.5 font-mono text-blue-300 text-xs">
                {key}:
              </span>
              <JsonValue depth={depth + 1} value={val} />
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function JsonValue({
  value,
  depth,
}: {
  value: unknown;
  depth: number;
}): ReactElement {
  if (value === null) {
    return <span className="font-mono text-xs text-zinc-500">null</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span
        className={cn(
          "font-mono text-xs",
          value ? "text-emerald-400" : "text-red-400"
        )}
      >
        {String(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="font-mono text-amber-400 text-xs">{value}</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="font-mono text-emerald-300 text-xs">
        &quot;{value}&quot;
      </span>
    );
  }
  if (Array.isArray(value)) {
    return <JsonArray depth={depth} value={value} />;
  }
  if (typeof value === "object") {
    return (
      <JsonObject depth={depth} value={value as Record<string, unknown>} />
    );
  }
  return (
    <span className="font-mono text-xs text-zinc-400">{String(value)}</span>
  );
}

export function JsonTree({ data, depth = 0, className }: JsonTreeProps) {
  return (
    <div
      className={cn(
        "overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3",
        className
      )}
    >
      <JsonValue depth={depth} value={data} />
    </div>
  );
}
