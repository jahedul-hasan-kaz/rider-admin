"use client";

import { ShieldCheck, UserRoundX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { restoreAccount } from "@/server/actions/privacy";
import type { DeletionRequest } from "@/server/queries/privacy";

/** People who asked to delete their account: deactivated now, anonymised when the grace period ends. */
export function DeletionList({ rows }: { rows: DeletionRequest[] }) {
  const t = useTranslations("privacy");
  const label = useStatusLabel();
  const router = useRouter();
  if (rows.length === 0) return <EmptyState icon={ShieldCheck} title={t("empty")} description={t("emptyBody")} />;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <Card key={r.id}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <UserRoundX className="size-4 text-muted-foreground" aria-hidden />
                {r.status === "completed" ? t("anonymised") : r.name}
                <span className="text-sm font-normal text-muted-foreground capitalize">({r.role})</span>
                <StatusBadge status={r.status === "completed" ? "closed" : r.status === "restored" ? "resolved" : "pending"} label={t(`status_${r.status}`)} />
              </p>
              <p className="text-xs text-muted-foreground">
                {t("requested")} <DateTime value={r.requested_at} relative />
                {r.status === "pending" ? (
                  <>
                    {" · "}
                    {t("anonymiseOn")} <DateTime value={r.anonymise_after} />
                  </>
                ) : null}
                {r.status === "completed" && r.completed_at ? (
                  <>
                    {" · "}
                    {t("completedOn")} <DateTime value={r.completed_at} relative />
                  </>
                ) : null}
              </p>
              {r.reason ? <p className="text-sm text-muted-foreground">{r.reason}</p> : null}
            </div>
            {r.can_restore ? (
              <ReasonDialog
                trigger={<Button variant="outline">{t("restore")}</Button>}
                title={t("restoreTitle", { name: r.name })}
                description={t("restoreBody")}
                confirmLabel={t("restore")}
                successMessage={t("restored")}
                presets={["Requested by mistake", "The person asked us to keep the account"]}
                onConfirm={(reason) => restoreAccount({ requestId: r.id, reason })}
                onSuccess={() => router.refresh()}
              />
            ) : null}
          </CardContent>
        </Card>
      ))}
      <span className="sr-only">{label("pending")}</span>
    </div>
  );
}
