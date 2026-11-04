import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import type { MapZone } from "@/components/domain/zone-map";
import type { ZoneGeometry } from "@/lib/geo";
import { requirePagePermission } from "@/server/auth/context";
import { getOpsSnapshot } from "@/server/queries/rides";
import { listZones } from "@/server/queries/supply";
import { LiveOps } from "./live-ops";

export const metadata: Metadata = { title: "Live operations" };

export default async function LivePage() {
  const [ctx, t] = await Promise.all([requirePagePermission("dispatch.view"), getTranslations("live")]);
  const [snapshot, zones] = await Promise.all([
    getOpsSnapshot(ctx),
    ctx.permissions.has("zones.view") ? listZones(ctx) : Promise.resolve([]),
  ]);
  const mapZones: MapZone[] = zones.map((z) => ({ id: z.id, name: z.name, active: z.active, boundary: z.boundary as ZoneGeometry }));

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <LiveOps initial={snapshot} zones={mapZones} />
    </>
  );
}
