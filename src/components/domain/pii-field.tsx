"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/domain/copy-button";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { Button } from "@/components/ui/button";
import { revealPii } from "@/server/actions/supply";

const HIDE_AFTER_MS = 30_000;

/**
 * Masked PII with an audited reveal (spec §2 "Formatting", §4.4). The value is
 * fetched only on reveal, never shipped with the page, and hides itself again.
 */
export function PiiField({
  profileId,
  field,
  masked,
  canReveal,
}: {
  profileId: string;
  field: "phone" | "email" | "licence_number";
  masked: string | null;
  canReveal: boolean;
}) {
  const t = useTranslations("pii");
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    if (value === null) return;
    const timer = setTimeout(() => setValue(null), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [value]);

  if (!masked) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-sm tabular">{value ?? masked}</span>
      {value ? (
        <>
          <CopyButton value={value} />
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setValue(null)} aria-label={t("hide")}>
            <EyeOff className="size-3.5" />
          </Button>
        </>
      ) : canReveal ? (
        <ReasonDialog
          trigger={
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
              <Eye className="size-3.5" />
              {t("reveal")}
            </Button>
          }
          title={t("revealTitle", { field: t(field) })}
          description={t("revealBody")}
          confirmLabel={t("reveal")}
          presets={["Customer support call", "Safety investigation", "Verifying identity"]}
          successMessage={t("revealed")}
          onConfirm={async (reason) => {
            const result = await revealPii({ profileId, field, reason });
            if (result.ok) setValue(result.data.value ?? "—");
            return result;
          }}
        />
      ) : null}
    </span>
  );
}
