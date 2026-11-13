"use client";

import { CircleAlert, CircleCheck, CircleDashed, CircleX, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDocumentTypeLabel, useStatusLabel } from "@/components/domain/status-text";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/server/queries/supply";

const ICONS = {
  approved: { icon: CircleCheck, className: "text-success" },
  pending: { icon: Clock, className: "text-info" },
  missing: { icon: CircleDashed, className: "text-muted-foreground" },
  rejected: { icon: CircleX, className: "text-danger" },
  expired: { icon: CircleAlert, className: "text-danger" },
} as const;

/** Required-document checklist. Optionally selectable (review screen). */
export function DocumentChecklist({
  items,
  selectedId,
  onSelect,
}: {
  items: ChecklistItem[];
  selectedId?: string | null;
  onSelect?: (item: ChecklistItem) => void;
}) {
  const docLabel = useDocumentTypeLabel();
  const statusLabel = useStatusLabel();
  const t = useTranslations("documents");

  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const { icon: Icon, className } = ICONS[item.state];
        const selectable = Boolean(onSelect && item.document_id);
        const content = (
          <>
            <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{docLabel(item.document_type)}</span>
              <span className="block text-xs text-muted-foreground">
                {statusLabel(item.state)}
                {item.expires_at ? ` · ${t("expires")} ${item.expires_at}` : ""}
              </span>
              {item.state === "rejected" && item.rejection_reason ? (
                <span className="block text-xs text-danger">{item.rejection_reason}</span>
              ) : null}
            </span>
          </>
        );
        return (
          <li key={item.document_type}>
            {selectable ? (
              <button
                type="button"
                onClick={() => onSelect?.(item)}
                aria-current={selectedId === item.document_id ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted",
                  selectedId === item.document_id && "bg-primary/10 ring-1 ring-primary/40",
                )}
              >
                {content}
              </button>
            ) : (
              <div className="flex items-start gap-2 px-2 py-2">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
