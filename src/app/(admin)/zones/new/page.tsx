import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import type { ZoneGeometry } from "@/lib/geo";
import { requirePagePermission } from "@/server/auth/context";
import { listZones } from "@/server/queries/supply";
import { ZoneEditor } from "../zone-editor";

export const metadata: Metadata = { title: "New zone" };

export default async function NewZonePage() {
  const [ctx, t] = await Promise.all([requirePagePermission("zones.manage"), getTranslations("zones")]);
  const zones = await listZones(ctx);
  return (
    <>
      <PageHeader title={t("editorNew")} description={t("drawHint")} />
      <ZoneEditor
        zone={null}
        canEdit
        otherZones={zones.map((z) => ({ id: z.id, name: z.name, active: z.active, boundary: z.boundary as ZoneGeometry }))}
      />
    </>
  );
}
