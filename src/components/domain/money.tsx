"use client";

import { useLocale } from "next-intl";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Tabular taka amount. */
export function Money({ value, className }: { value: number | string | null | undefined; className?: string }) {
  const locale = useLocale();
  return <span className={cn("tabular whitespace-nowrap", className)}>{formatMoney(value, locale)}</span>;
}
