import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="h-6 w-44 animate-pulse rounded bg-muted" />
          <div className="h-3 w-80 animate-pulse rounded bg-muted/60" />
        </div>
        <div className="h-7 w-32 animate-pulse rounded-full bg-muted" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div className="h-24 animate-pulse rounded-xl border bg-card" key={i} />
        ))}
      </div>

      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading AWS inventory & cost…
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((col) => (
          <div className="space-y-2 rounded-xl border bg-card p-4" key={col}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                className="h-6 w-full animate-pulse rounded bg-muted/40"
                key={i}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
