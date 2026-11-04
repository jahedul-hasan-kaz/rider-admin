import type { Metadata } from "next";
import { early } from "@/server/queries/rpc";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { RetireVehicleButton, VehicleFormButton } from "@/components/domain/crud-dialogs";
import { PageHeader } from "@/components/domain/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getFormRefs } from "@/server/queries/insight";
import { getVehicle } from "@/server/queries/supply";
import { VehicleActions, VehicleBadges, VehicleChecklist } from "./vehicle-client";

export const metadata: Metadata = { title: "Vehicle" };

export default async function VehiclePage({ params }: PageProps<"/vehicles/[id]">) {
  const [{ id }, ctx, t] = await Promise.all([params, requirePagePermission("vehicles.view"), getTranslations("vehicles")]);
  if (!z.uuid().safeParse(id).success) notFound();

  const refsP = early(getFormRefs(ctx));
  let vehicle;
  try {
    vehicle = await getVehicle(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{vehicle.registration_number}</span>}
        badge={<VehicleBadges vehicle={vehicle} />}
        description={`${vehicle.make} ${vehicle.model} · ${vehicle.category.name}`}
        actions={
          <>
            {vehicle.status !== "inactive" ? <VehicleFormButton vehicle={vehicle} categories={(await refsP).categories} /> : null}
            <VehicleActions vehicle={vehicle} />
            <RetireVehicleButton vehicleId={vehicle.id} status={vehicle.status} />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("colVehicle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("owner")}</dt>
              <dd>
                {ctx.permissions.has("drivers.view") ? (
                  <Link href={`/drivers/${vehicle.driver.id}` as Route} className="font-medium hover:underline">
                    {vehicle.driver.full_name}
                  </Link>
                ) : (
                  vehicle.driver.full_name
                )}
              </dd>
              <dt className="text-muted-foreground">{t("colCategory")}</dt>
              <dd>{vehicle.category.name}</dd>
              <dt className="text-muted-foreground">{t("year")}</dt>
              <dd className="tabular">{vehicle.year}</dd>
              <dt className="text-muted-foreground">{t("color")}</dt>
              <dd>{vehicle.color}</dd>
              {vehicle.suspended_reason ? (
                <>
                  <dt className="text-muted-foreground">{t("suspend")}</dt>
                  <dd className="text-danger">{vehicle.suspended_reason}</dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("documents")}</CardTitle>
          </CardHeader>
          <CardContent>
            <VehicleChecklist vehicle={vehicle} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
