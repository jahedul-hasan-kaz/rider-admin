import type { Metadata } from "next";
import { early } from "@/server/queries/rpc";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getTripFinance } from "@/server/queries/finance";
import { getTrip } from "@/server/queries/rides";
import { TripMoney } from "./trip-money";
import { TripActions, TripBadges, TripBody } from "./trip-client";

export const metadata: Metadata = { title: "Trip" };

export default async function TripPage({ params }: PageProps<"/trips/[id]">) {
  const [{ id }, ctx, t] = await Promise.all([params, requirePagePermission("trips.view"), getTranslations("trips")]);
  if (!z.uuid().safeParse(id).success) notFound();

  const financeP = early(ctx.permissions.has("payments.view") ? getTripFinance(ctx, id).catch(() => null) : Promise.resolve(null));
  let trip;
  try {
    trip = await getTrip(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const finance = await financeP;

  return (
    <>
      <PageHeader
        title={`${t("colTrip")} ${trip.id.slice(0, 8)}`}
        description={`${trip.pickup_label ?? "—"} → ${trip.destination_label ?? "—"}`}
        badge={<TripBadges trip={trip} />}
        actions={<TripActions trip={trip} />}
      />
      <TripBody trip={trip} canViewLocation={ctx.permissions.has("trips.view_location")} canNote={ctx.permissions.has("trips.note")} />
      {finance ? <TripMoney finance={finance} /> : null}
    </>
  );
}
