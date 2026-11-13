"use client";

import { BellOff, CircleAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ResolveAlertButton } from "@/components/domain/crud-dialogs";
import { acknowledgeAlert } from "@/server/actions/insight";
import type { OpsAlert } from "@/server/queries/insight";

/** Where to look for each kind of alert. */
const LINKS: Record<string, string> = {
  match_rate: "/requests",
  no_supply: "/live",
  sos_unacked: "/safety",
  recon_variance: "/payments?tab=unreconciled",
  ledger_verification: "/ledger",
  payout_failures: "/payouts",
  dispatch_lag: "/live",
};

export function AlertsList({ alerts, live }: { alerts: OpsAlert[]; live: boolean }) {
  const t = useTranslations("alerts");
  const can = useCan();
  const router = useRouter();

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(timer);
  }, [live, router]);

  if (alerts.length === 0) return <EmptyState icon={BellOff} title={live ? t("emptyOpen") : t("emptyResolved")} description={live ? t("emptyOpenBody") : undefined} />;
  const canAck = can("dispatch.intervene") || can("safety.manage") || can("ledger.adjust_approve") || can("payments.reconcile") || can("settings.manage");
  return (
    <div className="space-y-3">
      {alerts.map((a) => {
        const Icon = a.severity === "critical" ? CircleAlert : TriangleAlert;
        const link = LINKS[a.key.split(":")[0] ?? ""];
        return (
          <Card key={a.id} className={cn(a.severity === "critical" && a.status === "open" && "border-danger/50")}>
            <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="flex min-w-0 items-start gap-3">
                <Icon className={cn("mt-0.5 size-5 shrink-0", a.severity === "critical" ? "text-danger" : "text-warning")} aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("since")} <DateTime value={a.first_seen_at} relative />
                    {a.status === "resolved" && a.resolved_at ? (
                      <>
                        {" · "}
                        {t("resolvedAt")} <DateTime value={a.resolved_at} relative />
                      </>
                    ) : null}
                  </p>
                  {a.acknowledged_at ? (
                    <p className="text-xs text-muted-foreground">
                      {t("acknowledgedBy", { name: a.acknowledged_by_name ?? "—" })}: {a.ack_note}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {link ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={link as never}>{t("investigate")}</Link>
                  </Button>
                ) : null}
                {a.status === "open" && !a.acknowledged_at && canAck ? (
                  <ReasonDialog
                    trigger={<Button size="sm">{t("acknowledge")}</Button>}
                    title={t("ackTitle")}
                    description={t("ackBody")}
                    confirmLabel={t("acknowledge")}
                    successMessage={t("acknowledged")}
                    onConfirm={(note) => acknowledgeAlert({ id: a.id, note })}
                    onSuccess={() => router.refresh()}
                  />
                ) : null}
                {a.status === "open" ? <ResolveAlertButton id={a.id} /> : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
