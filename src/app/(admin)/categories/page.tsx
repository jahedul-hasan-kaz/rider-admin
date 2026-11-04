import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { listCategories } from "@/server/queries/supply";
import { CategoriesManager } from "./categories-manager";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const [ctx, t] = await Promise.all([requirePagePermission("categories.manage"), getTranslations("categories")]);
  const categories = await listCategories(ctx);
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <CategoriesManager key={categories.map((c) => `${c.id}:${c.version}:${c.sort_order}`).join("|")} categories={categories} />
    </>
  );
}
