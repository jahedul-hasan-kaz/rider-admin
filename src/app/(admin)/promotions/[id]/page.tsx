import type { Metadata } from "next";
import { early } from "@/server/queries/rpc";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getPromotion } from "@/server/queries/finance";
import { listFareRules } from "@/server/queries/rides";
import { PromotionActions, PromotionBadge, PromotionBody } from "./promotion-client";

export const metadata: Metadata = { title: "Promotion" };

export default async function PromotionPage({ params }: PageProps<"/promotions/[id]">) {
  const [{ id }, ctx] = await Promise.all([params, requirePagePermission("promotions.view")]);
  if (!z.uuid().safeParse(id).success) notFound();

  const refsP = early(listFareRules(ctx).catch(() => ({ categories: [], zones: [], rules: [] })));
  let promo;
  try {
    promo = await getPromotion(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const refs = await refsP;

  return (
    <>
      <PageHeader
        title={promo.name}
        description={<span className="font-mono">{promo.code}</span>}
        badge={<PromotionBadge promo={promo} />}
        actions={<PromotionActions promo={promo} categories={refs.categories} zones={refs.zones} />}
      />
      <PromotionBody promo={promo} />
    </>
  );
}
