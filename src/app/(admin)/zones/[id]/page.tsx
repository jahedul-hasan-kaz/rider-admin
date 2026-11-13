import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { StatusBadge } from "@/components/domain/status-badge";
import type { ZoneGeometry } from "@/lib/geo";
import { requirePagePermission } from "@/server/auth/context";
import { listZones } from "@/server/queries/supply";
import { ZoneEditor } from "../zone-editor";

export const metadata: Metadata = { title: "Zone" };

export default async function ZonePage({ params }: PageProps<"/zones/[id]">) {
  const [{ id }, ctx, t] = await Promise.all([params, requirePagePermission("zones.view"), getTranslations("zones")]);
  if (!z.uuid().safeParse(id).success) notFound();
  const zones = await listZones(ctx);
  const zone = zones.find((x) => x.id === id);
  if (!zone) notFound();

  return (
    <>
      <PageHeader
        title={zone.name}
        badge={<StatusBadge status={zone.active ? "active" : "inactive"} label={zone.active ? t("active") : t("inactive")} />}
      />
      <ZoneEditor
        key={`${zone.id}:${zone.version}`}
        zone={zone}
        canEdit={ctx.permissions.has("zones.manage")}
        otherZones={zones
          .filter((x) => x.id !== id)
          .map((x) => ({ id: x.id, name: x.name, active: x.active, boundary: x.boundary as ZoneGeometry }))}
      />
    </>
  );
}
