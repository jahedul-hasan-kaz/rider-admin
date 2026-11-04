"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DocumentChecklist } from "@/components/domain/checklist";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { suspendVehicle, verifyVehicle } from "@/server/actions/supply";
import type { VehicleDetail } from "@/server/queries/supply";

export function VehicleBadges({ vehicle }: { vehicle: VehicleDetail }) {
  const t = useTranslations("vehicles");
  const label = useStatusLabel();
  return (
    <>
      <StatusBadge status={vehicle.status} label={label(vehicle.status)} />
      {vehicle.is_current ? <Badge variant="secondary">{t("current")}</Badge> : null}
    </>
  );
}

export function VehicleChecklist({ vehicle }: { vehicle: VehicleDetail }) {
  return <DocumentChecklist items={vehicle.documents} />;
}

export function VehicleActions({ vehicle }: { vehicle: VehicleDetail }) {
  const t = useTranslations("vehicles");
  const can = useCan();
  const router = useRouter();
  if (!can("vehicles.verify")) return null;
  const plate = vehicle.registration_number;
  const docsApproved = vehicle.documents.every((d) => d.state === "approved");

  if (vehicle.status === "active") {
    return (
      <ReasonDialog
        trigger={
          <Button variant="outline" className="text-destructive">
            {t("suspend")}
          </Button>
        }
        title={t("suspendTitle", { plate })}
        description={t("suspendBody")}
        confirmLabel={t("suspend")}
        destructive
        presets={["Fitness certificate under review", "Accident reported", "Insurance lapsed"]}
        successMessage={t("suspendedToast")}
        onConfirm={(reason) => suspendVehicle({ vehicleId: vehicle.id, reason })}
        onSuccess={() => router.refresh()}
      />
    );
  }
  if (vehicle.status === "inactive") return null;

  const reinstate = vehicle.status === "suspended";
  return (
    <ReasonDialog
      trigger={<Button disabled={!docsApproved}>{reinstate ? t("reinstate") : t("verify")}</Button>}
      title={reinstate ? t("reinstateTitle", { plate }) : t("verifyTitle", { plate })}
      description={t("verifyBody")}
      confirmLabel={reinstate ? t("reinstate") : t("verify")}
      successMessage={t("verified")}
      onConfirm={(reason) => verifyVehicle({ vehicleId: vehicle.id, reason })}
      onSuccess={() => router.refresh()}
    />
  );
}
