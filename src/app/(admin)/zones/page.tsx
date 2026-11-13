import { MapPinned, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/domain/empty-state";
import { PageHeader } from "@/components/domain/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/context";
import { listZones } from "@/server/queries/supply";
import { ZonesOverview } from "./zones-overview";

export const metadata: Metadata = { title: "Zones" };

export default async function ZonesPage() {
  const [ctx, t] = await Promise.all([requirePagePermission("zones.view"), getTranslations("zones")]);
  const zones = await listZones(ctx);
  const canManage = ctx.permissions.has("zones.manage");

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/zones/new">
                <Plus className="size-4" />
                {t("new")}
              </Link>
            </Button>
          ) : null
        }
      />
      {zones.length === 0 ? (
        <Card>
          <EmptyState
            icon={MapPinned}
            title={t("empty")}
            action={
              canManage ? (
                <Button asChild>
                  <Link href="/zones/new">{t("new")}</Link>
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <ZonesOverview zones={zones} />
      )}
    </>
  );
}
