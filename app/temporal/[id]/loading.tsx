import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <div className="h-4 w-32 animate-pulse rounded bg-muted/60" />
      <div className="space-y-2">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-3 w-96 max-w-full animate-pulse rounded bg-muted/60" />
        <div className="h-5 w-64 animate-pulse rounded-full bg-muted/50" />
      </div>
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading event history…
      </div>
      <ol className="ml-2 space-y-3 border-border border-l">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li className="relative pl-6" key={i}>
            <span className="-left-[7px] absolute top-2 size-3 animate-pulse rounded-full bg-muted" />
            <div className="h-12 animate-pulse rounded-lg border bg-card" />
          </li>
        ))}
      </ol>
    </div>
  );
}
