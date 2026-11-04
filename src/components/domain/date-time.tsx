"use client";

import { useLocale, useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatRelative, formatUtc } from "@/lib/format";

/** Absolute Dhaka time with a relative hint; the tooltip shows UTC (spec §2). */
export function DateTime({ value, relative = false }: { value: string | null | undefined; relative?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("common");
  // The <time> below opts out of hydration checks: relative text is computed from "now" on the server and again
  // in the browser, so the two can legitimately differ by a tick.
  if (!value) return <span className="text-muted-foreground">{t("never")}</span>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={value} className="whitespace-nowrap tabular" suppressHydrationWarning>
          {relative ? formatRelative(value, locale) : formatDateTime(value, locale)}
        </time>
      </TooltipTrigger>
      <TooltipContent>
        <div>{formatDateTime(value, locale)} (Asia/Dhaka)</div>
        <div className="opacity-80">{formatUtc(value)}</div>
      </TooltipContent>
    </Tooltip>
  );
}
