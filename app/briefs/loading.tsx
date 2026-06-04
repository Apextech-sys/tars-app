import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="space-y-2">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-3 w-96 animate-pulse rounded bg-muted/60" />
      </div>

      <div className="h-12 animate-pulse rounded-xl border bg-card" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            className="h-24 animate-pulse rounded-xl border bg-card"
            key={i}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading briefs…
      </div>

      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            className="h-24 animate-pulse rounded-xl border bg-card"
            key={i}
          />
        ))}
      </div>
    </div>
  );
}
