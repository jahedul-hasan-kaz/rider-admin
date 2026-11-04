"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { CopyButton } from "@/components/domain/copy-button";
import { EmptyState } from "@/components/domain/empty-state";
import { Button } from "@/components/ui/button";

// Errors say what happened, what to do, and give a copyable reference (spec §1.4).
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  return (
    <EmptyState
      icon={TriangleAlert}
      title={t("errorTitle")}
      description={t("errorBody")}
      className="min-h-[50vh]"
      action={
        <div className="flex flex-col items-center gap-3">
          {error.digest ? (
            <div className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
              <span className="text-muted-foreground">{t("reference")}:</span>
              <code className="font-mono">{error.digest}</code>
              <CopyButton value={error.digest} />
            </div>
          ) : null}
          <Button onClick={reset}>{t("retry")}</Button>
        </div>
      }
    />
  );
}
