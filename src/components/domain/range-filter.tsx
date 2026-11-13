"use client";

import { CalendarRange } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { Autocomplete } from "@/components/domain/autocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RangePreset } from "@/lib/date-range";

type Ref = { id: string; name: string };

/** Date range presets plus zone and category, all URL-synced so a view can be shared or bookmarked. */
export function RangeFilter({
  preset,
  from,
  to,
  zone,
  category,
  zones,
  categories,
}: {
  preset: RangePreset;
  from: string;
  to: string;
  zone?: string;
  category?: string;
  zones: Ref[];
  categories: Ref[];
}) {
  const t = useTranslations("insight");
  const { setParams, pending } = useUrlParams();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  const presets: { key: RangePreset; label: string }[] = [
    { key: "today", label: t("rangeToday") },
    { key: "7d", label: t("range7d") },
    { key: "30d", label: t("range30d") },
    { key: "custom", label: t("rangeCustom") },
  ];

  return (
    <div className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div className="flex rounded-lg border p-0.5" role="group" aria-label={t("rangeLabel")}>
        {presets.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={preset === p.key ? "secondary" : "ghost"}
            className="h-7"
            aria-pressed={preset === p.key}
            onClick={() => setParams({ range: p.key === "7d" ? null : p.key, from: p.key === "custom" ? customFrom : null, to: p.key === "custom" ? customTo : null })}
          >
            {p.label}
          </Button>
        ))}
      </div>
      {preset === "custom" ? (
        <div className="flex items-center gap-2">
          <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
          <Input type="date" className="h-8 w-36" value={customFrom} max={customTo} aria-label={t("from")} onChange={(e) => setCustomFrom(e.target.value)} />
          <span className="text-muted-foreground">→</span>
          <Input type="date" className="h-8 w-36" value={customTo} min={customFrom} aria-label={t("to")} onChange={(e) => setCustomTo(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => setParams({ range: "custom", from: customFrom, to: customTo })}>
            {t("apply")}
          </Button>
        </div>
      ) : null}
      <Autocomplete
        source="zones"
        className="h-8 w-44"
        aria-label={t("zone")}
        value={zone ?? ""}
        selectedLabel={zones.find((z) => z.id === zone)?.name}
        clearLabel={t("allZones")}
        onChange={(v) => setParams({ zone: v || null })}
      />
      <Autocomplete
        source="categories"
        className="h-8 w-44"
        aria-label={t("category")}
        value={category ?? ""}
        selectedLabel={categories.find((c) => c.id === category)?.name}
        clearLabel={t("allCategories")}
        onChange={(v) => setParams({ category: v || null })}
      />
    </div>
  );
}
