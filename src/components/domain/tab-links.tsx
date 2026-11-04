import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-synced tabs (spec §4.2): each tab is a link, so state survives reloads and sharing. */
export function TabLinks({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="flex gap-1 border-b" aria-label="Tabs">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href as Route}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count != null ? (
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular">{tab.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
