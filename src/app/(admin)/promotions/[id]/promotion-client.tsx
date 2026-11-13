"use client";

import { Pause, Pencil, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Money } from "@/components/domain/money";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { Stat, StatGrid } from "@/components/domain/stat";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { DateTime } from "@/components/domain/date-time";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setPromotionStatus } from "@/server/actions/finance";
import type { PromotionDetail } from "@/server/queries/finance";
import { discountLabel, PromotionEditor } from "../promotions-client";

export function PromotionBadge({ promo }: { promo: PromotionDetail }) {
  const t = useTranslations("promotions");
  const label = useStatusLabel();
  return <StatusBadge status={promo.live ? "active" : promo.status} label={promo.live ? t("live") : label(promo.status)} />;
}

export function PromotionActions({ promo, categories, zones }: { promo: PromotionDetail; categories: { id: string; name: string }[]; zones: { id: string; name: string }[] }) {
  const t = useTranslations("promotions");
  const can = useCan();
  const router = useRouter();
  if (!can("promotions.manage") || promo.status === "ended") return null;

  const change = (status: "active" | "paused" | "ended", icon: React.ReactNode, key: string, destructive = false) => (
    <ReasonDialog
      trigger={
        <Button variant="outline" className={destructive ? "text-destructive" : undefined}>
          {icon}
          {t(`action_${key}`)}
        </Button>
      }
      title={t(`title_${key}`)}
      description={t(`body_${key}`)}
      confirmLabel={t(`action_${key}`)}
      destructive={destructive}
      successMessage={t("statusChanged")}
      onConfirm={(reason) => setPromotionStatus({ id: promo.id, status, reason })}
      onSuccess={() => router.refresh()}
    />
  );

  return (
    <>
      <PromotionEditor
        promotion={promo}
        categories={categories}
        zones={zones}
        trigger={
          <Button variant="outline">
            <Pencil className="size-4" />
            {t("edit")}
          </Button>
        }
      />
      {promo.status === "active" ? change("paused", <Pause className="size-4" />, "pause") : change("active", <Play className="size-4" />, "activate")}
      {change("ended", <Square className="size-4" />, "end", true)}
    </>
  );
}

export function PromotionBody({ promo }: { promo: PromotionDetail }) {
  const t = useTranslations("promotions");
  const locale = useLocale();
  const roi = promo.roi;
  const pct = promo.budget_limit ? Math.min(100, (promo.budget_spent / promo.budget_limit) * 100) : null;
  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat label={t("roiApplied")} hint={t("roiAppliedHint", { reserved: roi.reserved })}>
          {roi.applied}
        </Stat>
        <Stat label={t("roiSpend")}>{roi.discount_spend.toLocaleString()}</Stat>
        <Stat label={t("roiContribution")} hint={t("roiContributionHint")} tone={roi.contribution < 0 ? "danger" : "success"}>
          {roi.contribution.toLocaleString()}
        </Stat>
        <Stat label={t("roiNewPassengers")}>{roi.new_passengers}</Stat>
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("terms")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Term label={t("colDiscount")}>{discountLabel(promo, locale)}</Term>
              <Term label={t("fMinFare")}>
                <Money value={promo.min_fare} />
              </Term>
              <Term label={t("fPerUser")}>{promo.per_user_limit}</Term>
              <Term label={t("fTotalLimit")}>{promo.total_redemption_limit ?? t("unlimited")}</Term>
              <Term label={t("fStarts")}>
                <DateTime value={promo.starts_at} />
              </Term>
              <Term label={t("fEnds")}>
                <DateTime value={promo.ends_at} />
              </Term>
              <Term label={t("fNewUsersOnly")}>{promo.new_users_only ? t("yes") : t("no")}</Term>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("colBudget")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {pct !== null && promo.budget_limit ? (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <p className="tabular">
                  <Money value={promo.budget_spent} /> / <Money value={promo.budget_limit} /> {t("held")}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">{t("noBudgetCap")}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("budgetExplain")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
