"use client";

import { Repeat, TimerOff } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DateTime } from "@/components/domain/date-time";
import { FareBreakdown } from "@/components/domain/fare-breakdown";
import { Money } from "@/components/domain/money";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { Timeline } from "@/components/domain/timeline";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDistance, formatDuration } from "@/lib/format";
import { expireRequest, redispatchRequest } from "@/server/actions/rides";
import type { RequestDetail } from "@/server/queries/rides";
import { requestTone } from "../requests-table";

export function RequestBadges({ request }: { request: RequestDetail }) {
  const label = useStatusLabel();
  return <StatusBadge status={requestTone(request.status)} label={label(request.status)} />;
}

export function RequestActions({ request }: { request: RequestDetail }) {
  const t = useTranslations("requests");
  const can = useCan();
  const router = useRouter();
  return (
    <>
      {request.trip_id ? (
        <Button asChild variant="outline">
          <Link href={`/trips/${request.trip_id}` as Route}>{t("trip")}</Link>
        </Button>
      ) : null}
      {request.status === "searching" && can("dispatch.intervene") ? (
        <>
          <ReasonDialog
            trigger={
              <Button variant="outline">
                <Repeat className="size-4" />
                {t("redispatch")}
              </Button>
            }
            title={t("redispatchTitle")}
            description={t("redispatchBody")}
            confirmLabel={t("redispatch")}
            presets={["Driver not responding", "Offer stuck", "Better driver available"]}
            successMessage={t("redispatched")}
            onConfirm={(reason) => redispatchRequest({ requestId: request.id, reason })}
            onSuccess={() => router.refresh()}
          />
          <ReasonDialog
            trigger={
              <Button variant="outline" className="text-destructive">
                <TimerOff className="size-4" />
                {t("expire")}
              </Button>
            }
            title={t("expireTitle")}
            description={t("expireBody")}
            confirmLabel={t("expire")}
            destructive
            presets={["No coverage at this hour", "Passenger called to cancel"]}
            successMessage={t("expired")}
            onConfirm={(reason) => expireRequest({ requestId: request.id, reason })}
            onSuccess={() => router.refresh()}
          />
        </>
      ) : null}
    </>
  );
}

export function RequestBody({ request }: { request: RequestDetail }) {
  const t = useTranslations("requests");
  const label = useStatusLabel();

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("offersTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {request.offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("offersEmpty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs tracking-wide text-muted-foreground uppercase">
                      <th className="py-2 pr-3 font-medium">{t("colRank")}</th>
                      <th className="py-2 pr-3 font-medium">{t("colDriver")}</th>
                      <th className="py-2 pr-3 font-medium">{t("colDistance")}</th>
                      <th className="py-2 pr-3 font-medium">{t("colEta")}</th>
                      <th className="py-2 pr-3 font-medium">{t("colResponse")}</th>
                      <th className="py-2 font-medium">{t("colResponseTime")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {request.offers.map((o) => (
                      <tr key={o.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 tabular">{o.rank}</td>
                        <td className="py-2 pr-3">
                          <Link href={`/drivers/${o.driver_id}` as Route} className="font-medium hover:underline">
                            {o.driver_name}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 tabular">{formatDistance(o.pickup_distance_m)}</td>
                        <td className="py-2 pr-3 tabular">{formatDuration(o.pickup_eta_s)}</td>
                        <td className="py-2 pr-3">
                          <StatusBadge
                            status={o.response === "accepted" ? "completed" : o.response === "pending" ? "pending" : o.response === "rejected" ? "failed" : "cancelled"}
                            label={label(o.response)}
                          />
                          {o.reason ? <span className="ml-2 text-xs text-muted-foreground">{o.reason}</span> : null}
                        </td>
                        <td className="py-2 tabular">{o.response_s !== null ? t("seconds", { count: o.response_s }) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("eventsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Timeline
              items={request.events.map((e) => ({
                id: e.id,
                title: label(e.to_status),
                meta: (
                  <>
                    {e.actor_name ?? e.actor_type} · <DateTime value={e.created_at} />
                  </>
                ),
                body: e.reason,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("quoteTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {request.quote ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {t("rule", { version: request.quote.rule_version ?? 0 })} · ×{request.quote.surge_multiplier}
                </p>
                <FareBreakdown data={request.quote.breakdown} />
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("passenger")}</dt>
              <dd>
                <Link href={`/passengers/${request.passenger.id}` as Route} className="font-medium hover:underline">
                  {request.passenger.name}
                </Link>
              </dd>
              <dt className="text-muted-foreground">{t("colCategory")}</dt>
              <dd>
                {request.category} · {request.zone}
              </dd>
              <dt className="text-muted-foreground">{t("payment")}</dt>
              <dd>{request.payment_method}</dd>
              <dt className="text-muted-foreground">{t("estimatedFare")}</dt>
              <dd>
                <Money value={request.estimated_fare} /> · {formatDistance(request.estimated_distance_m)} · {formatDuration(request.estimated_duration_s)}
              </dd>
              <dt className="text-muted-foreground">{t("round")}</dt>
              <dd className="tabular">{request.dispatch_round}</dd>
              <dt className="text-muted-foreground">{t("requestedAt")}</dt>
              <dd>
                <DateTime value={request.requested_at} />
              </dd>
              <dt className="text-muted-foreground">{t("expiresAt")}</dt>
              <dd>
                <DateTime value={request.expires_at} />
              </dd>
              {request.closed_at ? (
                <>
                  <dt className="text-muted-foreground">{t("closedAt")}</dt>
                  <dd>
                    <DateTime value={request.closed_at} />
                  </dd>
                </>
              ) : null}
              {request.pickup_note ? (
                <>
                  <dt className="text-muted-foreground">{t("pickupNote")}</dt>
                  <dd>{request.pickup_note}</dd>
                </>
              ) : null}
              {request.cancel_reason ? (
                <>
                  <dt className="text-muted-foreground">{t("colStatus")}</dt>
                  <dd>{request.cancel_reason}</dd>
                </>
              ) : null}
            </dl>
            {!request.pickup ? <p className="mt-3 text-xs text-muted-foreground">{t("noCoords")}</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
