"use client";

import { CarFront, Clock, Hand, RefreshCw, TriangleAlert, UserRoundSearch } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveMap } from "@/components/domain/live-map";
import { EmptyState } from "@/components/domain/empty-state";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import type { MapZone } from "@/components/domain/zone-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadOpsSnapshot } from "@/server/actions/rides";
import type { OpsSnapshot } from "@/server/queries/rides";

const STALE_AFTER_S = 30;

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "warning" }) {
  return (
    <Card className="gap-1 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold tabular", tone === "warning" && "text-warning")}>{value}</p>
    </Card>
  );
}

/**
 * Manual refresh mode (for now): the snapshot loads with the page and again only when the person presses Refresh
 * (or "r"). No polling and no realtime subscription. The private `ops:live` channel is still broadcast by the
 * database, so live updates can be switched back on later (spec 01 §3.3).
 */
export function LiveOps({ initial, zones }: { initial: OpsSnapshot; zones: MapZone[] }) {
  const t = useTranslations("live");
  const label = useStatusLabel();
  const [snapshot, setSnapshot] = useState(initial);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"searching" | "trips" | "exceptions">("searching");
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await loadOpsSnapshot();
      if (res.ok) {
        setSnapshot(res.data);
        setFetchedAt(Date.now());
      }
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Only the "updated … ago" label ticks; no data is fetched in the background.
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "r" && !e.metaKey && !e.ctrlKey && !e.altKey && !(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) {
        e.preventDefault();
        void refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(tick);
      window.removeEventListener("keydown", onKey);
    };
  }, [refresh]);

  const age = Math.max(0, Math.round((now - fetchedAt) / 1000));
  const stale = age > STALE_AFTER_S;
  const m = snapshot.metrics;
  const exceptionCount = snapshot.exceptions.fare_review + snapshot.exceptions.stuck_searching;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-neutral-soft text-neutral">
          <Hand className="mr-1 size-3" aria-hidden />
          {t("manualMode")}
        </Badge>
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing} aria-keyshortcuts="r">
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden />
          {refreshing ? t("refreshing") : t("refresh")}
          <kbd className="ml-1 hidden rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground sm:inline">R</kbd>
        </Button>
        <span className={cn("flex items-center gap-1 text-xs", stale ? "text-warning" : "text-muted-foreground")} aria-live="polite">
          <Clock className="size-3" aria-hidden />
          {stale ? t("stale", { seconds: age }) : t("updated", { seconds: age })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label={t("onlineDrivers")} value={m.online_drivers} />
        <Metric label={t("onTripDrivers")} value={m.on_trip_drivers} />
        <Metric label={t("searching")} value={m.searching} tone={m.searching > 0 && snapshot.exceptions.stuck_searching > 0 ? "warning" : undefined} />
        <Metric label={t("activeTrips")} value={m.active_trips} />
        <Metric label={t("medianMatch")} value={m.median_match_s === null ? "—" : formatDuration(m.median_match_s)} />
        <Metric label={t("noDriver1h")} value={m.no_driver_1h} tone={m.no_driver_1h > 0 ? "warning" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-2">
          <LiveMap snapshot={snapshot} zones={zones} label={t("mapLabel")} />
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-success" aria-hidden />{t("legendOnline")}</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-info" aria-hidden />{t("legendOnTrip")}</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-warning" aria-hidden />{t("legendRequest")}</span>
          </div>
        </div>

        <Card className="gap-0 p-0">
          <div role="tablist" className="flex border-b">
            {(
              [
                ["searching", t("tabSearching"), snapshot.requests.length],
                ["trips", t("tabTrips"), snapshot.trips.length],
                ["exceptions", t("tabExceptions"), exceptionCount],
              ] as const
            ).map(([key, name, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-sm font-medium",
                  tab === key ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {name}
                <span className="rounded-full bg-muted px-1.5 text-xs tabular">{count}</span>
              </button>
            ))}
          </div>

          <div className="max-h-[480px] overflow-y-auto" role="tabpanel">
            {tab === "searching" ? (
              snapshot.requests.length === 0 ? (
                <EmptyState icon={UserRoundSearch} title={t("emptySearching")} className="py-10" />
              ) : (
                <ul className="divide-y">
                  {snapshot.requests.map((r) => {
                    const waitedS = Math.max(0, Math.round((now - Date.parse(r.requested_at)) / 1000));
                    return (
                      <li key={r.id}>
                        <Link href={`/requests/${r.id}` as Route} className="block px-4 py-3 hover:bg-muted/50">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{r.passenger}</span>
                            <span className={cn("text-xs tabular", waitedS > 90 ? "font-medium text-warning" : "text-muted-foreground")}>
                              {t("waiting", { time: formatDuration(waitedS) })}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{r.pickup_label ?? "—"} · {r.category}</p>
                          <p className="text-xs text-muted-foreground">{t("offers", { count: r.offers })}</p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}

            {tab === "trips" ? (
              snapshot.trips.length === 0 ? (
                <EmptyState icon={CarFront} title={t("emptyTrips")} className="py-10" />
              ) : (
                <ul className="divide-y">
                  {snapshot.trips.map((trip) => (
                    <li key={trip.id}>
                      <Link href={`/trips/${trip.id}` as Route} className="block px-4 py-3 hover:bg-muted/50">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{trip.driver}</span>
                          <StatusBadge status="in_progress" label={label(trip.status)} />
                        </div>
                        <p className="text-xs text-muted-foreground">{trip.passenger}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            ) : null}

            {tab === "exceptions" ? (
              exceptionCount === 0 ? (
                <EmptyState icon={TriangleAlert} title={t("emptyExceptions")} className="py-10" />
              ) : (
                <ul className="divide-y text-sm">
                  {snapshot.exceptions.stuck_searching > 0 ? (
                    <li>
                      <Link href={"/requests?status=searching" as Route} className="flex items-center gap-2 px-4 py-3 hover:bg-muted/50">
                        <TriangleAlert className="size-4 text-warning" aria-hidden />
                        {t("stuck", { count: snapshot.exceptions.stuck_searching })}
                      </Link>
                    </li>
                  ) : null}
                  {snapshot.exceptions.fare_review > 0 ? (
                    <li>
                      <Link href={"/trips?tab=flagged" as Route} className="flex items-center gap-2 px-4 py-3 hover:bg-muted/50">
                        <TriangleAlert className="size-4 text-warning" aria-hidden />
                        {t("fareReview", { count: snapshot.exceptions.fare_review })}
                      </Link>
                    </li>
                  ) : null}
                </ul>
              )
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
