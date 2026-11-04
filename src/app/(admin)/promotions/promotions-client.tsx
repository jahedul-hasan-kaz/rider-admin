"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Ticket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { FormDialog } from "@/components/domain/form-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { savePromotion } from "@/server/actions/finance";
import type { Promotion } from "@/server/queries/finance";

type Ref = { id: string; name: string };

export function discountLabel(p: Pick<Promotion, "discount_type" | "discount_value" | "max_discount">, locale: string) {
  if (p.discount_type === "percent") return `${p.discount_value}%${p.max_discount ? ` (≤ ${formatMoney(p.max_discount, locale)})` : ""}`;
  return formatMoney(p.discount_value, locale);
}

export function PromotionsTable({ rows }: { rows: Promotion[] }) {
  const t = useTranslations("promotions");
  const label = useStatusLabel();
  const columns = useMemo<ColumnDef<Promotion, unknown>[]>(
    () => [
      {
        id: "promo",
        header: t("colPromotion"),
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{row.original.code}</p>
          </div>
        ),
      },
      { id: "discount", header: t("colDiscount"), cell: ({ row }) => <span className="tabular">{discountLabel(row.original, "en")}</span> },
      {
        id: "usage",
        header: t("colUsage"),
        cell: ({ row }) => (
          <span className="tabular">
            {row.original.redemptions}
            {row.original.total_redemption_limit ? ` / ${row.original.total_redemption_limit}` : ""}
          </span>
        ),
      },
      {
        id: "budget",
        header: t("colBudget"),
        cell: ({ row }) =>
          row.original.budget_limit ? (
            <div className="w-32 space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round((row.original.budget_spent / row.original.budget_limit) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (row.original.budget_spent / row.original.budget_limit) * 100)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground tabular">
                {row.original.budget_spent.toLocaleString()} / {row.original.budget_limit.toLocaleString()}
              </p>
            </div>
          ) : (
            <span className="text-muted-foreground">{t("noBudgetCap")}</span>
          ),
      },
      {
        id: "window",
        header: t("colWindow"),
        cell: ({ row }) => (
          <div className="text-xs">
            <DateTime value={row.original.starts_at} />
            <span className="text-muted-foreground"> → </span>
            <DateTime value={row.original.ends_at} />
          </div>
        ),
      },
      {
        id: "status",
        header: t("colStatus"),
        cell: ({ row }) => <StatusBadge status={row.original.live ? "active" : row.original.status} label={row.original.live ? t("live") : label(row.original.status)} />,
      },
    ],
    [t, label],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/promotions/${r.id}`}
      caption={t("title")}
      empty={<EmptyState icon={Ticket} title={t("empty")} />}
    />
  );
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function NewPromotionButton({ categories, zones }: { categories: Ref[]; zones: Ref[] }) {
  const t = useTranslations("promotions");
  const can = useCan();
  if (!can("promotions.manage")) return null;
  return (
    <PromotionEditor
      categories={categories}
      zones={zones}
      trigger={
        <Button>
          <Plus className="size-4" />
          {t("new")}
        </Button>
      }
    />
  );
}

/** Create or edit a promotion. Once redemptions exist the code and discount are locked by the database. */
export function PromotionEditor({
  promotion,
  categories,
  zones,
  trigger,
}: {
  promotion?: Promotion;
  categories: Ref[];
  zones: Ref[];
  trigger: React.ReactNode;
}) {
  const t = useTranslations("promotions");
  const router = useRouter();
  const locked = Boolean(promotion && promotion.redemptions > 0);
  const initial = () => ({
    code: promotion?.code ?? "",
    name: promotion?.name ?? "",
    description: promotion?.description ?? "",
    type: promotion?.discount_type ?? ("fixed" as "fixed" | "percent"),
    value: promotion ? String(promotion.discount_value) : "",
    maxDiscount: promotion?.max_discount ? String(promotion.max_discount) : "",
    minFare: promotion ? String(promotion.min_fare) : "0",
    startsAt: toLocalInput(promotion?.starts_at ?? new Date().toISOString()),
    endsAt: toLocalInput(promotion?.ends_at ?? new Date(Date.now() + 30 * 86_400_000).toISOString()),
    perUser: promotion ? String(promotion.per_user_limit) : "1",
    totalLimit: promotion?.total_redemption_limit ? String(promotion.total_redemption_limit) : "",
    budget: promotion?.budget_limit ? String(promotion.budget_limit) : "",
    newUsersOnly: promotion?.new_users_only ?? false,
    zoneIds: promotion?.zone_ids ?? ([] as string[]),
    categoryIds: promotion?.category_ids ?? ([] as string[]),
  });
  const [f, setF] = useState(initial);
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const toggle = (key: "zoneIds" | "categoryIds", id: string) =>
    setF((prev) => ({ ...prev, [key]: prev[key].includes(id) ? prev[key].filter((x) => x !== id) : [...prev[key], id] }));

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const valid = f.code.trim().length >= 3 && f.name.trim().length >= 2 && Number(f.value) > 0;

  return (
    <FormDialog
      trigger={trigger}
      title={promotion ? t("editTitle") : t("newTitle")}
      description={t("editorBody")}
      confirmLabel={promotion ? t("save") : t("create")}
      valid={valid}
      successMessage={t("saved")}
      onSubmit={() =>
        savePromotion({
          id: promotion?.id ?? null,
          expectedVersion: promotion?.version ?? null,
          payload: {
            code: f.code,
            name: f.name,
            description: f.description || undefined,
            discount_type: f.type,
            discount_value: Number(f.value),
            max_discount: f.type === "percent" ? num(f.maxDiscount) : null,
            min_fare: Number(f.minFare || 0),
            starts_at: new Date(f.startsAt).toISOString(),
            ends_at: new Date(f.endsAt).toISOString(),
            zone_ids: f.zoneIds,
            category_ids: f.categoryIds,
            new_users_only: f.newUsersOnly,
            per_user_limit: Number(f.perUser || 1),
            total_redemption_limit: num(f.totalLimit),
            budget_limit: num(f.budget),
          },
        })
      }
      onSuccess={() => router.refresh()}
      onClose={() => setF(initial())}
    >
      {(errors) => (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {errors.promotion ? <FieldError>{errors.promotion}</FieldError> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="promo-code">{t("fCode")}</FieldLabel>
              <Input id="promo-code" value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} disabled={locked} maxLength={20} className="font-mono" />
            </Field>
            <Field>
              <FieldLabel htmlFor="promo-name">{t("fName")}</FieldLabel>
              <Input id="promo-name" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="promo-desc">{t("fDescription")}</FieldLabel>
            <Textarea id="promo-desc" value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={500} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel>{t("fType")}</FieldLabel>
              <Select value={f.type} onValueChange={(v) => set("type", v as "fixed" | "percent")} disabled={locked}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">{t("typeFixed")}</SelectItem>
                  <SelectItem value="percent">{t("typePercent")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="promo-value">{f.type === "percent" ? t("fPercent") : t("fAmount")}</FieldLabel>
              <Input id="promo-value" inputMode="decimal" value={f.value} onChange={(e) => set("value", e.target.value)} disabled={locked} />
            </Field>
            {f.type === "percent" ? (
              <Field>
                <FieldLabel htmlFor="promo-max">{t("fMaxDiscount")}</FieldLabel>
                <Input id="promo-max" inputMode="decimal" value={f.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value)} />
              </Field>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="promo-start">{t("fStarts")}</FieldLabel>
              <Input id="promo-start" type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="promo-end">{t("fEnds")}</FieldLabel>
              <Input id="promo-end" type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="promo-min">{t("fMinFare")}</FieldLabel>
              <Input id="promo-min" inputMode="decimal" value={f.minFare} onChange={(e) => set("minFare", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="promo-per">{t("fPerUser")}</FieldLabel>
              <Input id="promo-per" inputMode="numeric" value={f.perUser} onChange={(e) => set("perUser", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="promo-total">{t("fTotalLimit")}</FieldLabel>
              <Input id="promo-total" inputMode="numeric" value={f.totalLimit} onChange={(e) => set("totalLimit", e.target.value)} placeholder={t("unlimited")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="promo-budget">{t("fBudget")}</FieldLabel>
              <Input id="promo-budget" inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} placeholder={t("unlimited")} />
            </Field>
          </div>
          <FieldDescription>{t("budgetHelp")}</FieldDescription>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.newUsersOnly} onCheckedChange={(v) => set("newUsersOnly", v === true)} />
            {t("fNewUsersOnly")}
          </label>
          {zones.length > 0 ? (
            <Field>
              <FieldLabel>{t("fZones")}</FieldLabel>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {zones.map((z) => (
                  <label key={z.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={f.zoneIds.includes(z.id)} onCheckedChange={() => toggle("zoneIds", z.id)} />
                    {z.name}
                  </label>
                ))}
              </div>
              <FieldDescription>{t("allWhenEmpty")}</FieldDescription>
            </Field>
          ) : null}
          {categories.length > 0 ? (
            <Field>
              <FieldLabel>{t("fCategories")}</FieldLabel>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={f.categoryIds.includes(c.id)} onCheckedChange={() => toggle("categoryIds", c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
        </div>
      )}
    </FormDialog>
  );
}
