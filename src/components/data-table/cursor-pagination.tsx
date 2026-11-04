"use client";

import { ChevronRight, ChevronsLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useUrlParams } from "./use-url-params";

/** Keyset pagination (no OFFSET): next page and back to the first page. */
export function CursorPagination({ nextCursor }: { nextCursor: string | number | null | undefined }) {
  const t = useTranslations("common");
  const { searchParams, setParams, pending } = useUrlParams();
  const onFirstPage = !searchParams.get("cursor");

  if (onFirstPage && nextCursor == null) return null;

  return (
    <div className="flex items-center justify-end gap-2">
      {!onFirstPage ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setParams({ cursor: null }, { resetCursor: false })}>
          <ChevronsLeft className="size-4" />
          {t("firstPage")}
        </Button>
      ) : null}
      {nextCursor != null ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => setParams({ cursor: String(nextCursor) }, { resetCursor: false })}
        >
          {t("loadMore")}
          <ChevronRight className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
