import { CalendarDays, MapPin, TriangleAlert } from "lucide-react";
import { early } from "@/server/queries/rpc";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { DeleteAccountButton, EditContactButton, UploadDocumentButton, VehicleFormButton } from "@/components/domain/crud-dialogs";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getFormRefs } from "@/server/queries/insight";
import { getDriver } from "@/server/queries/supply";
import { DriverActions } from "./driver-actions";
import { DriverActivity, DriverDocuments, DriverHeaderBadges, DriverOverview, DriverVehicles } from "./driver-sections";

export const metadata: Metadata = { title: "Driver" };

const TABS = ["overview", "documents", "vehicles", "activity"] as const;

export default async function DriverPage({ params, searchParams }: PageProps<"/drivers/[id]">) {
  const [{ id }, query, ctx, t, locale] = await Promise.all([
    params,
    searchParams,
    requirePagePermission("drivers.view"),
    getTranslations("drivers"),
    getLocale(),
  ]);
  if (!z.uuid().safeParse(id).success) notFound();

  const refsP = early(getFormRefs(ctx));
  let driver;
  try {
    driver = await getDriver(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const tab = TABS.find((x) => x === query.tab) ?? "overview";
  const refs = await refsP;
  const liveVehicles = driver.vehicles.filter((v) => v.status !== "inactive");

  return (
    <>
      <PageHeader
        title={driver.full_name}
        badge={<DriverHeaderBadges driver={driver} />}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden />
              {t("colJoined")} {formatDate(driver.created_at, locale)}
            </span>
            {driver.zone ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {driver.zone.name}
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <EditContactButton profileId={driver.user_id} role="driver" name={driver.full_name} />
            <VehicleFormButton driverId={driver.id} categories={refs.categories} />
            <UploadDocumentButton driverId={driver.id} vehicles={liveVehicles} />
            <DriverActions driver={driver} />
            <DeleteAccountButton profileId={driver.user_id} role="driver" name={driver.full_name} status={driver.account_status} />
          </>
        }
      />

      {driver.onboarding_status === "rejected" && driver.rejected_reason ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>{t("rejectedBanner", { reason: driver.rejected_reason })}</AlertDescription>
        </Alert>
      ) : null}
      {driver.onboarding_status === "suspended" && driver.suspended_reason ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>{t("suspendedBanner", { reason: driver.suspended_reason })}</AlertDescription>
        </Alert>
      ) : null}

      <TabLinks
        active={tab}
        tabs={[
          { key: "overview", label: t("tabOverview"), href: `/drivers/${id}` },
          { key: "documents", label: t("tabDocuments"), href: `/drivers/${id}?tab=documents` },
          { key: "vehicles", label: t("tabVehicles"), href: `/drivers/${id}?tab=vehicles`, count: driver.vehicles.length },
          { key: "activity", label: t("tabActivity"), href: `/drivers/${id}?tab=activity` },
        ]}
      />

      {tab === "overview" ? (
        <DriverOverview driver={driver} canRevealPii={ctx.permissions.has("drivers.view_pii")} />
      ) : tab === "documents" ? (
        <DriverDocuments driver={driver} />
      ) : tab === "vehicles" ? (
        <DriverVehicles driver={driver} />
      ) : (
        <DriverActivity driver={driver} />
      )}
    </>
  );
}
