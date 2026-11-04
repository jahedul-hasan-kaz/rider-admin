import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { getCatalogue } from "@/server/queries/admins";
import { TemplateCards } from "./template-cards";

export const metadata: Metadata = { title: "Permission templates" };

export default async function TemplatesPage() {
  const [ctx, t] = await Promise.all([requirePagePermission("admins.view"), getTranslations("templates")]);
  const catalogue = await getCatalogue(ctx);
  const canEdit = ctx.isSuperAdmin && ctx.permissions.has("admins.manage_permissions");

  return (
    <>
      <PageHeader title={t("title")} description={canEdit ? t("subtitle") : `${t("subtitle")}. ${t("onlySuperAdmins")}`} />
      <TemplateCards catalogue={catalogue} canEdit={canEdit} />
    </>
  );
}
