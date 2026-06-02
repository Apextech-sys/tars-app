"use client";

import {
  AlignJustify,
  BookOpen,
  Cog,
  GitBranch,
  GitPullRequest,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Network,
  Server,
  ShieldCheck,
  Webhook,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pr-runs", label: "PR Runs", icon: GitPullRequest },
  { href: "/knowledge", label: "Knowledge", icon: Network },
  { href: "/infra", label: "Infrastructure", icon: Server },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/briefs", label: "Briefs", icon: BookOpen },
  { href: "/audit", label: "Audit", icon: ShieldCheck },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/workflows", label: "Workflows", icon: GitBranch },
  { href: "/settings", label: "Settings", icon: Cog },
];

/** Returns true when viewport width is below 768px. */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    setNarrow(mql.matches);
    const listener = () => setNarrow(mql.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);
  return narrow;
}

/** Top bar visible only on mobile (< 768px) with hamburger. */
export function MobileTopBar({
  title,
  onOpen,
  inboxCount,
}: {
  title: string;
  onOpen: () => void;
  inboxCount?: number;
}) {
  const isNarrow = useIsNarrow();
  if (!isNarrow) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background px-4 py-3 md:hidden">
      <Button
        aria-label="Open navigation menu"
        className="relative min-h-[44px] min-w-[44px] p-0"
        data-testid="hamburger-btn"
        onClick={onOpen}
        size="sm"
        variant="ghost"
      >
        <AlignJustify className="size-5" />
        {inboxCount && inboxCount > 0 ? (
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive font-bold text-[9px] text-destructive-foreground">
            {inboxCount > 9 ? "9+" : inboxCount}
          </span>
        ) : null}
      </Button>
      <span className="font-semibold text-foreground text-sm">{title}</span>
    </header>
  );
}

/** Side drawer that slides in from the left on mobile. */
export function MobileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  // Close on route change
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  // Trap body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-auto fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 md:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div
        aria-label="Navigation menu"
        aria-modal="true"
        className={cn(
          "pointer-events-auto fixed top-0 left-0 z-50 flex h-full w-64 flex-col border-r bg-background shadow-xl transition-transform duration-200 md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded bg-[#00d4a0]">
              <span className="font-bold text-[10px] text-black">T</span>
            </div>
            <span className="font-semibold text-sm">TARS</span>
          </div>
          <Button
            aria-label="Close navigation menu"
            className="min-h-[44px] min-w-[44px] p-0"
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-3 font-medium text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
                href={href}
                key={href}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}

/** Sidebar visible on desktop (>= 768px). */
export function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen md:flex md:w-56 md:shrink-0 md:flex-col md:border-r md:bg-background lg:w-64">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex size-6 items-center justify-center rounded bg-[#00d4a0]">
          <span className="font-bold text-[10px] text-black">T</span>
        </div>
        <span className="font-semibold text-sm">TARS</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              href={href}
              key={href}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * DashboardShell: wraps content with desktop sidebar + mobile hamburger.
 * Use on all non-workflow routes.
 */
export function DashboardShell({
  children,
  title,
  inboxCount,
}: {
  children: React.ReactNode;
  title: string;
  inboxCount?: number;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="pointer-events-auto flex h-screen overflow-hidden bg-background">
      <DesktopSidebar />
      <MobileDrawer onClose={() => setDrawerOpen(false)} open={drawerOpen} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileTopBar
          inboxCount={inboxCount}
          onOpen={() => setDrawerOpen(true)}
          title={title}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
