"use client";

import { Autocomplete } from "@/components/domain/autocomplete";
import { ArrowDown, ArrowUp, Bike, Bus, Car, CarTaxiFront, Pencil, Plus, Siren, Truck, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { errorKey, fieldErrors } from "@/lib/action-errors";
import { CATEGORY_ICONS } from "@/lib/schemas/supply";
import { reorderCategories, saveCategory } from "@/server/actions/supply";
import type { Category } from "@/server/queries/supply";

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  bike: Bike,
  car: Car,
  cng: CarTaxiFront,
  microbus: Bus,
  ambulance: Siren,
  truck: Truck,
};

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const t = useTranslations("categories");
  const locale = useLocale();
  const label = useStatusLabel();
  const router = useRouter();
  const [order, setOrder] = useState(categories);
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  function move(index: number, delta: number) {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    setOrder(next);
    startTransition(async () => {
      const result = await reorderCategories({ ids: next.map((c) => c.id) });
      if (result.ok) {
        toast.success(t("reordered"));
        router.refresh();
      } else {
        setOrder(categories);
        toast.error(result.error.message);
      }
    });
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          {t("new")}
        </Button>
      </div>
      <Card className="divide-y p-0">
        {order.map((c, i) => {
          const Icon = CATEGORY_ICON[c.icon] ?? Car;
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex flex-col">
                <Button variant="ghost" size="icon" className="size-6" disabled={i === 0 || pending} onClick={() => move(i, -1)} aria-label={t("moveUp")}>
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={i === order.length - 1 || pending}
                  onClick={() => move(i, 1)}
                  aria-label={t("moveDown")}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </div>
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {locale === "bn" && c.name_bn ? c.name_bn : c.name} <code className="ml-1 text-xs text-muted-foreground">{c.code}</code>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("colCapacity")}: {c.passenger_capacity} · {t("colVehicles")}: {c.vehicle_count}
                  {c.description ? ` · ${c.description}` : ""}
                </p>
              </div>
              <StatusBadge status={c.active ? "active" : "inactive"} label={label(c.active ? "active" : "inactive")} />
              <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                <Pencil className="size-3.5" />
                {t("edit")}
              </Button>
            </div>
          );
        })}
        {order.length === 0 ? <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p> : null}
      </Card>
      {editing ? (
        <CategoryDialog
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function CategoryDialog({ category, onClose, onSaved }: { category: Category | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations();
  const [code, setCode] = useState(category?.code ?? "");
  const [name, setName] = useState(category?.name ?? "");
  const [nameBn, setNameBn] = useState(category?.name_bn ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [capacity, setCapacity] = useState(category?.passenger_capacity ?? 1);
  const [icon, setIcon] = useState(category?.icon ?? "car");
  const [active, setActive] = useState(category?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    startTransition(async () => {
      const result = await saveCategory({
        id: category?.id ?? null,
        code,
        name,
        nameBn: nameBn || undefined,
        description: description || undefined,
        passengerCapacity: capacity,
        icon,
        active,
        expectedVersion: category?.version ?? null,
      });
      if (result.ok) {
        toast.success(t("categories.saved"));
        onSaved();
      } else {
        const f = fieldErrors(result.error);
        setFields(f);
        if (!Object.keys(f).length) setError(t(`errors.${errorKey(result.error.code)}`));
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{category ? `${t("categories.edit")}: ${category.name}` : t("categories.new")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            {!category ? (
              <Field data-invalid={Boolean(fields.code) || undefined}>
                <FieldLabel htmlFor="c-code">{t("categories.code")}</FieldLabel>
                <Input id="c-code" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="car_ac" />
                <FieldDescription>{fields.code ?? t("zones.codeHelp")}</FieldDescription>
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="c-name">{t("categories.name")}</FieldLabel>
                <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="c-name-bn">{t("categories.nameBn")}</FieldLabel>
                <Input id="c-name-bn" value={nameBn} onChange={(e) => setNameBn(e.target.value)} maxLength={60} lang="bn" />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="c-desc">{t("categories.description")}</FieldLabel>
              <Input id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="c-cap">{t("categories.capacity")}</FieldLabel>
                <Input
                  id="c-cap"
                  type="number"
                  min={1}
                  max={20}
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="c-icon">{t("categories.icon")}</FieldLabel>
                <Autocomplete id="c-icon" value={icon} onChange={(v) => v && setIcon(v)} options={CATEGORY_ICONS.map((key) => ({ value: key, label: key }))} />
              </Field>
            </div>
            <label className="flex items-center gap-3 text-sm" htmlFor="c-active">
              <Switch id="c-active" checked={active} onCheckedChange={setActive} />
              {t("categories.active")}
            </label>
          </FieldGroup>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name || (!category && !code)}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
