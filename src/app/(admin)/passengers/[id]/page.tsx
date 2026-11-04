import { TriangleAlert } from "lucide-react";
import { early } from "@/server/queries/rpc";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { BookRideButton, DeleteAccountButton, EditContactButton } from "@/components/domain/crud-dialogs";
import { PageHeader } from "@/components/domain/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getFormRefs } from "@/server/queries/insight";
import { getPassenger } from "@/server/queries/supply";
import { PassengerActions, PassengerBadges, PassengerDetails, PassengerHistory } from "./passenger-client";

export const metadata: Metadata = { title: "Passenger" };

export default async function PassengerPage({ params }: PageProps<"/passengers/[id]">) {
  const [{ id }, ctx, t] = await Promise.all([params, requirePagePermission("passengers.view"), getTranslations("passengers")]);
  if (!z.uuid().safeParse(id).success) notFound();

  const refsP = early(getFormRefs(ctx));
  let passenger;
  try {
    passenger = await getPassenger(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={passenger.full_name}
        badge={<PassengerBadges passenger={passenger} />}
        actions={
          <>
            {passenger.status === "active" ? <BookRideButton categories={(await refsP).categories} passenger={{ id: passenger.id, name: passenger.full_name }} /> : null}
            <EditContactButton profileId={passenger.id} role="passenger" name={passenger.full_name} />
            <PassengerActions passenger={passenger} />
            <DeleteAccountButton profileId={passenger.id} role="passenger" name={passenger.full_name} status={passenger.status} />
          </>
        }
      />
      {passenger.status === "suspended" && passenger.suspended_reason ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>{passenger.suspended_reason}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <PassengerDetails
          passenger={passenger}
          canRevealPii={ctx.permissions.has("passengers.view_pii")}
          canEdit={ctx.permissions.has("passengers.update")}
        />
        <PassengerHistory passenger={passenger} />
      </div>
      <p className="text-sm text-muted-foreground">{t("rides")}</p>
    </>
  );
}
