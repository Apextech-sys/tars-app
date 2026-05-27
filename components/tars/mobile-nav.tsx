"use client";

import {
  AlignJustify,
  BookOpen,
  Cog,
  GitBranch,
  Inbox,
  MessageSquare,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/briefs", label: "Briefs", icon: BookOpen },
  { href: "/audit", label: "Audit", icon: ShieldCheck },
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
  if (!isNarrow) return null;

  return (
    <header className="flex items-center gap-3 border-b bg-background px-4 py-3 md:hidden sticky top-0 z-40">
      <Button
        size="sm"
        variant="ghost"
        className="min-h-[44px] min-w-[44px] p-0 relative"
        aria-label="Open navigation menu"
        data-testid="hamburger-btn"
        onClick={onOpen}
      >
        <AlignJustify className="size-5" />
        {inboxCount && inboxCount > 0 ? (
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
            {inboxCount > 9 ? "9+" : inboxCount}
          </span>
        ) : null}
      </Button>
      <span className="text-sm font-semibold text-foreground">{title}</span>
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
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 md:hidden pointer-events-auto",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
      />
      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-64 flex-col bg-background border-r shadow-xl transition-transform duration-200 md:hidden pointer-events-auto",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="size-6 rounded bg-[#00d4a0] flex items-center justify-center">
              <span className="text-[10px] font-bold text-black">T</span>
            </div>
            <span className="text-sm font-semibold">TARS</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-[44px] min-w-[44px] p-0"
            aria-label="Close navigation menu"
            onClick={onClose}
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/"
                ? pathname === "/"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[44px]",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                aria-current={isActive ? "page" : undefined}
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
    <aside className="hidden md:flex md:w-56 lg:w-64 md:flex-col md:border-r md:bg-background md:shrink-0 h-screen sticky top-0">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="size-6 rounded bg-[#00d4a0] flex items-center justify-center">
          <span className="text-[10px] font-bold text-black">T</span>
        </div>
        <span className="text-sm font-semibold">TARS</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/"
              ? pathname === "/"
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
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
    <div className="flex min-h-screen bg-background pointer-events-auto">
      <DesktopSidebar />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex flex-1 flex-col min-w-0">
        <MobileTopBar
          title={title}
          onOpen={() => setDrawerOpen(true)}
          inboxCount={inboxCount}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
