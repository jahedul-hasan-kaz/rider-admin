"use client";

import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** The "?" next to every metric: the exact definition, so every team calculates it the same way (spec §5.20). */
export function KpiHelp({ title, children }: { title: string; children: ReactNode }) {
  const t = useTranslations("insight");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("definitionOf", { name: title })}>
          <CircleHelp className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-1 text-sm">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </PopoverContent>
    </Popover>
  );
}
