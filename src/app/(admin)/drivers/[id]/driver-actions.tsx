"use client";

import { ClipboardCheck, PowerOff, UserCheck, UserX, XCircle } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCan } from "@/components/permissions-provider";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { Button } from "@/components/ui/button";
import { forceDriverOffline, reactivateDriver, rejectDriver, suspendDriver } from "@/server/actions/supply";
import type { DriverDetail } from "@/server/queries/supply";

/** Status-dependent primary and secondary actions for one driver (spec §5.5). */
export function DriverActions({ driver }: { driver: DriverDetail }) {
  const t = useTranslations("drivers");
  const can = useCan();
  const router = useRouter();
  const refresh = () => router.refresh();
  const name = driver.full_name;
  const reviewable = driver.onboarding_status === "submitted" || driver.onboarding_status === "under_review";

  return (
    <>
      {reviewable && (can("documents.review") || can("drivers.approve")) ? (
        <Button asChild>
          <Link href={`/drivers/${driver.id}/review` as Route}>
            <ClipboardCheck className="size-4" />
            {t("review")}
          </Link>
        </Button>
      ) : null}

      {reviewable && can("drivers.approve") ? (
        <ReasonDialog
          trigger={
            <Button variant="outline" className="text-destructive">
              <XCircle className="size-4" />
              {t("reject")}
            </Button>
          }
          title={t("rejectTitle", { name })}
          description={t("rejectBody")}
          confirmLabel={t("reject")}
          destructive
          presets={["Documents unreadable", "Licence not valid for this vehicle", "Failed background check"]}
          successMessage={t("rejected")}
          onConfirm={(reason) => rejectDriver({ driverId: driver.id, reason })}
          onSuccess={refresh}
        />
      ) : null}

      {driver.availability === "online" && can("dispatch.intervene") ? (
        <ReasonDialog
          trigger={
            <Button variant="outline">
              <PowerOff className="size-4" />
              {t("forceOffline")}
            </Button>
          }
          title={t("forceOfflineTitle", { name })}
          description={t("forceOfflineBody")}
          confirmLabel={t("forceOffline")}
          presets={["Not responding to offers", "Vehicle issue reported", "Safety check"]}
          successMessage={t("offlineDone")}
          onConfirm={(reason) => forceDriverOffline({ driverId: driver.id, reason })}
          onSuccess={refresh}
        />
      ) : null}

      {driver.onboarding_status === "approved" && can("drivers.suspend") ? (
        <ReasonDialog
          trigger={
            <Button variant="outline" className="text-destructive">
              <UserX className="size-4" />
              {t("suspend")}
            </Button>
          }
          title={t("suspendTitle", { name })}
          description={t("suspendBody")}
          confirmLabel={t("suspend")}
          destructive
          confirmWord="SUSPEND"
          presets={["Customer safety complaint", "Document fraud suspected", "Repeated cancellations"]}
          successMessage={t("suspended")}
          onConfirm={(reason) => suspendDriver({ driverId: driver.id, reason })}
          onSuccess={refresh}
        />
      ) : null}

      {driver.onboarding_status === "suspended" && can("drivers.suspend") ? (
        <ReasonDialog
          trigger={
            <Button variant="outline">
              <UserCheck className="size-4" />
              {t("reactivate")}
            </Button>
          }
          title={t("reactivateTitle", { name })}
          description={t("reactivateBody")}
          confirmLabel={t("reactivate")}
          successMessage={t("reactivated")}
          onConfirm={(reason) => reactivateDriver({ driverId: driver.id, reason })}
          onSuccess={refresh}
        />
      ) : null}
    </>
  );
}
