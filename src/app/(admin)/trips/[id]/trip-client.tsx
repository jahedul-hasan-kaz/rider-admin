"use client";

import { Ban, CircleAlert, MapPinOff, RefreshCw, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DateTime } from "@/components/domain/date-time";
import { FareBreakdown } from "@/components/domain/fare-breakdown";
import { Money } from "@/components/domain/money";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { RouteMap } from "@/components/domain/route-map";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { Timeline, type TimelineItem } from "@/components/domain/timeline";
import { useCan } from "@/components/permissions-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { errorKey } from "@/lib/action-errors";
import { formatDistance, formatDuration } from "@/lib/format";
import { addTripNote, cancelTrip, resolveTripFailed } from "@/server/actions/rides";
import type { TripDetail } from "@/server/queries/rides";
import { tripTone } from "../trips-table";

const ACTIVE = ["driver_assigned", "driver_arriving", "arrived", "in_progress"];

export function TripBadges({ trip }: { trip: TripDetail }) {
  const label = useStatusLabel();
  return <StatusBadge status={tripTone(trip.status)} label={label(trip.status)} />;
}

export function TripActions({ trip }: { trip: TripDetail }) {
  const t = useTranslations("trips");
  const can = useCan();
  const router = useRouter();
  const tLive = useTranslations("live");
  const [refreshing, startRefresh] = useTransition();
  if (!ACTIVE.includes(trip.status)) return null;
  return (
    <>
      {/* Manual refresh for now: the trip page does not update itself while a ride is in progress. */}
      <Button variant="outline" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing}>
        <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
        {refreshing ? tLive("refreshing") : tLive("refresh")}
      </Button>
      {can("trips.cancel") ? (
        <ReasonDialog
          trigger={
            <Button variant="outline" className="text-destructive">
              <Ban className="size-4" />
              {t("cancel")}
            </Button>
          }
          title={t("cancelTitle")}
          description={t("cancelBody")}
          confirmLabel={t("cancel")}
          destructive
          confirmWord="CANCEL"
          presets={["Driver unreachable", "Safety concern", "Passenger requested by phone"]}
          successMessage={t("cancelled")}
          onConfirm={(reason) => cancelTrip({ tripId: trip.id, reason })}
          onSuccess={() => router.refresh()}
        />
      ) : null}
      {can("trips.resolve") ? (
        <ReasonDialog
          trigger={<Button variant="outline">{t("resolve")}</Button>}
          title={t("resolveTitle")}
          description={t("resolveBody")}
          confirmLabel={t("resolve")}
          destructive
          presets={["Driver stopped responding", "Vehicle breakdown mid-ride"]}
          successMessage={t("resolved")}
          onConfirm={(reason) => resolveTripFailed({ tripId: trip.id, reason })}
          onSuccess={() => router.refresh()}
        />
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function NoteComposer({ tripId }: { tripId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await addTripNote({ tripId, body });
          if (res.ok) {
            toast.success(t("trips.noteAdded"));
            setBody("");
            router.refresh();
          } else toast.error(t(`errors.${errorKey(res.error.code)}`));
        });
      }}
    >
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={4000} placeholder={t("trips.notePlaceholder")} />
      <Button type="submit" size="sm" disabled={pending || !body.trim()}>
        {t("trips.addNote")}
      </Button>
    </form>
  );
}

export function TripBody({ trip, canViewLocation, canNote }: { trip: TripDetail; canViewLocation: boolean; canNote: boolean }) {
  const t = useTranslations();
  const label = useStatusLabel();

  const variancePct =
    trip.final_fare !== null && trip.estimated_fare > 0 ? Math.round(((trip.final_fare - trip.estimated_fare) / trip.estimated_fare) * 100) : null;

  const timeline: TimelineItem[] = trip.events.map((e) => {
    const data = e.event_data as { override?: boolean; distance_to_pickup_m?: number; fee?: number };
    return {
      id: e.id,
      title: label(e.to_status),
      tone: ["failed", "cancelled_by_driver", "cancelled_by_admin", "cancelled_by_passenger"].includes(e.to_status)
        ? ("danger" as const)
        : e.to_status === "completed"
          ? ("success" as const)
          : ("default" as const),
      meta: (
        <>
          {e.actor_name ?? t(`trips.actor.${e.actor_type}`)} · <DateTime value={e.created_at} />
        </>
      ),
      body: (
        <>
          {e.reason ? <p>{e.reason}</p> : null}
          {data.override ? (
            <p className="text-warning">
              {t("trips.override")}
              {typeof data.distance_to_pickup_m === "number" ? `: ${t("trips.distanceToPickup", { meters: data.distance_to_pickup_m })}` : ""}
            </p>
          ) : null}
        </>
      ),
    };
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-6">
        {trip.fare_review_required ? (
          <Alert>
            <TriangleAlert className="size-4" />
            <AlertTitle>{t("trips.reviewFlag")}</AlertTitle>
            <AlertDescription>{t("trips.reviewBody")}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("trips.route")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canViewLocation ? (
              trip.trail?.length || trip.pickup ? (
                <RouteMap pickup={trip.pickup} destination={trip.destination} trail={trip.trail} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("trips.noTrail")}</p>
              )
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPinOff className="size-4" aria-hidden />
                {t("trips.routeHidden")}
              </p>
            )}
            {canViewLocation && trip.trail && trip.trail.length === 0 && trip.status === "completed" ? (
              <p className="text-xs text-muted-foreground">{t("trips.noTrail")}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("trips.timeline")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Timeline items={timeline} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("trips.notes")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canNote ? <NoteComposer tripId={trip.id} /> : null}
            {trip.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("trips.noNotes")}</p>
            ) : (
              <ul className="space-y-3">
                {trip.notes.map((n) => (
                  <li key={n.id} className="rounded-md bg-warning-soft/40 p-3 text-sm">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.author} · <DateTime value={n.created_at} relative />
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("trips.fareTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{t("trips.estimated")}</p>
                <p className="text-lg font-semibold">
                  <Money value={trip.estimated_fare} />
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{t("trips.final")}</p>
                <p className="text-lg font-semibold">
                  <Money value={trip.final_fare} />
                </p>
                {variancePct !== null ? (
                  <p className={variancePct > 0 ? "text-xs text-warning" : "text-xs text-muted-foreground"}>{t("trips.variance", { pct: variancePct > 0 ? `+${variancePct}` : variancePct })}</p>
                ) : null}
              </div>
            </div>
            {trip.breakdown ? (
              <FareBreakdown data={trip.breakdown} />
            ) : trip.quote ? (
              <>
                <p className="text-xs text-muted-foreground">{t("trips.estimated")} · {t("requests.rule", { version: trip.rule_version })}</p>
                <FareBreakdown data={trip.quote} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("trips.noBreakdown")}</p>
            )}
            {trip.distance_source ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CircleAlert className="size-3.5" aria-hidden />
                {trip.distance_source === "trail" ? t("trips.sourceTrail") : t("trips.sourceFallback")}
              </p>
            ) : null}
            {trip.cancellation_fee > 0 ? (
              <p className="text-sm">
                {t("trips.cancellationFee")}: <Money value={trip.cancellation_fee} />
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("trips.rideDetails")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label={t("trips.passenger")}>
                <Link href={`/passengers/${trip.passenger.id}` as Route} className="font-medium hover:underline">
                  {trip.passenger.name}
                </Link>
              </Row>
              <Row label={t("trips.driver")}>
                <Link href={`/drivers/${trip.driver.id}` as Route} className="font-medium hover:underline">
                  {trip.driver.name}
                </Link>
              </Row>
              <Row label={t("trips.vehicle")}>
                <Link href={`/vehicles/${trip.vehicle.id}` as Route} className="font-mono text-xs hover:underline">
                  {trip.vehicle.registration_number}
                </Link>{" "}
                · {trip.vehicle.category}
              </Row>
              <Row label={t("trips.zone")}>{trip.zone}</Row>
              <Row label={t("trips.payment")}>{trip.payment_method}</Row>
              <Row label={t("trips.distance")}>
                <span className="tabular">{formatDistance(trip.distance_m)}</span>
              </Row>
              <Row label={t("trips.duration")}>
                <span className="tabular">{formatDuration(trip.duration_s)}</span>
              </Row>
              <Row label={t("trips.waiting")}>
                <span className="tabular">{formatDuration(trip.waiting_s)}</span>
              </Row>
              {trip.cancelled_by ? <Row label={t("trips.cancelledBy", { actor: t(`trips.actor.${trip.cancelled_by}`) })}>{trip.cancellation_reason}</Row> : null}
              <Row label={t("requests.title")}>
                <Link href={`/requests/${trip.request_id}` as Route} className="text-xs hover:underline">
                  {trip.request_id.slice(0, 8)}
                </Link>
              </Row>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
