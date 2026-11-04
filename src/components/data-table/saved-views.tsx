"use client";

import { Bookmark, BookmarkPlus, Share2, Trash2 } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/domain/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { deleteSavedView, loadSavedViews, saveView, type SavedView } from "@/server/actions/views";

/** Pages that can keep saved views (matches the database check). */
const PAGES = new Set(["trips", "requests", "payments", "support", "drivers", "passengers", "documents", "vehicles", "refunds", "ratings", "safety", "audit"]);

/** "My views" next to a list's filters: apply a saved filter set in one click, save the current one, share it with colleagues. */
export function SavedViews() {
  const t = useTranslations("views");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = pathname.split("/")[1] ?? "";
  const enabled = PAGES.has(page);
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    const result = await loadSavedViews({ page });
    if (result.ok) setViews(result.data);
  }, [enabled, page]);

  useEffect(() => {
    // Fetching on mount is the point: views live on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!enabled) return null;
  // The cursor is a position, not a filter: it is never saved.
  const current = new URLSearchParams(searchParams.toString());
  current.delete("cursor");
  const query = current.toString();

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Bookmark className="size-4" />
            {t("myViews")}
            {views.length > 0 ? <span className="rounded-full bg-muted px-1.5 text-xs tabular">{views.length}</span> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>{t("savedFilters")}</DropdownMenuLabel>
          {views.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("none")}</p> : null}
          {views.map((v) => (
            <div key={v.id} className="flex items-center">
              <DropdownMenuItem className="flex-1" onSelect={() => router.push((v.query ? `${pathname}?${v.query}` : pathname) as Route)}>
                {v.is_shared && !v.mine ? <Share2 className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                <span className="truncate">{v.name}</span>
                {v.owner_name ? <span className="ml-auto text-xs text-muted-foreground">{v.owner_name}</span> : null}
              </DropdownMenuItem>
              {v.mine ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t("delete", { name: v.name })}
                  onClick={async () => {
                    const result = await deleteSavedView({ id: v.id });
                    if (result.ok) {
                      toast.success(t("deleted"));
                      void load();
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
          <DropdownMenuSeparator />
          <p className="px-2 py-1 text-xs text-muted-foreground">{query ? t("currentHas") : t("currentEmpty")}</p>
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog
        trigger={
          <Button variant="ghost" size="sm" aria-label={t("saveCurrent")} disabled={!query}>
            <BookmarkPlus className="size-4" />
          </Button>
        }
        title={t("saveTitle")}
        description={t("saveBody")}
        confirmLabel={t("save")}
        valid={name.trim().length > 0}
        successMessage={t("saved")}
        onSubmit={() => saveView({ page, name, query, shared })}
        onSuccess={() => {
          setName("");
          void load();
        }}
        onClose={() => {
          setName("");
          setShared(false);
        }}
      >
        {(errors) => (
          <div className="space-y-3">
            <Field data-invalid={Boolean(errors.name) || undefined}>
              <FieldLabel htmlFor="view-name">{t("name")}</FieldLabel>
              <Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
              {errors.name ? <p className="text-sm text-destructive">{errors.name}</p> : null}
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={shared} onCheckedChange={(v) => setShared(v === true)} />
              {t("share")}
            </label>
          </div>
        )}
      </FormDialog>
    </div>
  );
}
