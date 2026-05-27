"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonTreeProps {
  data: unknown;
  depth?: number;
  className?: string;
}

function JsonValue({
  value,
  depth,
}: {
  value: unknown;
  depth: number;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(depth < 2);

  if (value === null) {
    return <span className="text-zinc-500 font-mono text-xs">null</span>;
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
    return <span className="text-amber-400 font-mono text-xs">{value}</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="text-emerald-300 font-mono text-xs">
        &quot;{value}&quot;
      </span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-zinc-400 font-mono text-xs">[]</span>;
    }
    return (
      <span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="inline-flex items-center gap-0.5 text-zinc-300 hover:text-white font-mono text-xs"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <span className="text-zinc-400">
            [{value.length} item{value.length !== 1 ? "s" : ""}]
          </span>
        </button>
        {expanded && (
          <div className="ml-4 border-l border-zinc-700 pl-3 mt-1 space-y-1">
            {value.map((item, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: position is stable for display
              <div key={i} className="flex gap-2 items-start">
                <span className="text-zinc-600 font-mono text-xs shrink-0 pt-0.5">
                  {i}:
                </span>
                <JsonValue value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-zinc-400 font-mono text-xs">{"{}"}</span>;
    }
    return (
      <span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="inline-flex items-center gap-0.5 text-zinc-300 hover:text-white font-mono text-xs"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <span className="text-zinc-400">
            {"{"}
            {entries.length} key{entries.length !== 1 ? "s" : ""}
            {"}"}
          </span>
        </button>
        {expanded && (
          <div className="ml-4 border-l border-zinc-700 pl-3 mt-1 space-y-1">
            {entries.map(([key, val]) => (
              <div key={key} className="flex gap-2 items-start flex-wrap">
                <span className="text-blue-300 font-mono text-xs shrink-0 pt-0.5">
                  {key}:
                </span>
                <JsonValue value={val} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }
  return (
    <span className="text-zinc-400 font-mono text-xs">{String(value)}</span>
  );
}

export function JsonTree({ data, depth = 0, className }: JsonTreeProps) {
  return (
    <div
      className={cn(
        "rounded-lg bg-zinc-950/60 border border-zinc-800 p-3 overflow-auto",
        className
      )}
    >
      <JsonValue value={data} depth={depth} />
    </div>
  );
}
