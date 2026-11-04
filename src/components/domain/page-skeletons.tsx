import { Skeleton } from "@/components/ui/skeleton";

// Shown by loading.tsx while a page's data loads on the server, shaped like the page so nothing jumps when it arrives.

function HeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-[70vw]" />
      </div>
      {action ? <Skeleton className="h-9 w-32" /> : null}
    </div>
  );
}

/** Title, toolbar, a table. Used by every list page. */
export function ListPageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <HeaderSkeleton />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-full sm:w-64" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="ml-auto hidden h-9 w-24 sm:block" />
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex gap-4 border-b bg-muted/60 px-4 py-3">
          {[24, 16, 20, 12, 14].map((w, i) => (
            <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
          ))}
        </div>
        {Array.from({ length: 8 }, (_, r) => (
          <div key={r} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0">
            {[24, 16, 20, 12, 14].map((w, i) => (
              <Skeleton key={i} className="h-4" style={{ width: `${w - (r % 3) * 2}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** KPI cards, charts and tables. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <HeaderSkeleton action={false} />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-44" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-48 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A record page: header, a main column of cards, a side column. */
export function DetailPageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <HeaderSkeleton />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <Skeleton className="h-4 w-28" />
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex justify-between gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Metrics, the map and the side list of Live operations. */
export function LiveSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <HeaderSkeleton action={false} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-2 rounded-xl border bg-card px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-10" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-[520px] w-full rounded-lg" />
        <Skeleton className="h-[520px] w-full rounded-xl" />
      </div>
    </div>
  );
}
