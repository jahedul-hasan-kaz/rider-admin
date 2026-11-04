"use client";

import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { deletePermissionTemplate } from "@/server/actions/admins/permissions";
import type { Catalogue, CatalogueTemplate } from "@/server/queries/admins";
import { TemplateEditorDialog } from "./template-editor-dialog";

export function TemplateCards({ catalogue, canEdit }: { catalogue: Catalogue; canEdit: boolean }) {
  const t = useTranslations("templates");
  const router = useRouter();
  const [editing, setEditing] = useState<CatalogueTemplate | "new" | null>(null);
  const [deleting, setDeleting] = useState<CatalogueTemplate | null>(null);

  return (
    <>
      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {catalogue.templates.map((tpl) => {
          const locked = tpl.code === "super_admin";
          return (
            <Card key={tpl.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{tpl.name}</CardTitle>
                  <Badge variant={tpl.is_builtin ? "secondary" : "outline"}>
                    {tpl.is_builtin ? t("builtin") : t("custom")}
                  </Badge>
                </div>
                {tpl.description ? <CardDescription>{tpl.description}</CardDescription> : null}
              </CardHeader>
              <CardContent className="flex-1 space-y-1 text-sm text-muted-foreground">
                <p>{t("permissionCount", { count: tpl.permissions.length })}</p>
                <p>{t("adminCount", { count: tpl.admin_count })}</p>
                <code className="block pt-1 text-xs">{tpl.code}</code>
              </CardContent>
              {canEdit ? (
                <CardFooter className="gap-2">
                  {locked ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3.5" aria-hidden /> {t("superAdminLocked")}
                    </p>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditing(tpl)}>
                        <Pencil className="size-3.5" />
                        {t("edit")}
                      </Button>
                      {!tpl.is_builtin ? (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(tpl)}>
                          <Trash2 className="size-3.5" />
                          {t("delete")}
                        </Button>
                      ) : null}
                    </>
                  )}
                </CardFooter>
              ) : null}
            </Card>
          );
        })}
      </div>

      {editing ? (
        <TemplateEditorDialog
          template={editing === "new" ? null : editing}
          permissions={catalogue.permissions}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <ReasonDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("deleteTitle", { name: deleting?.name ?? "" })}
        description={t("deleteBody")}
        confirmLabel={t("delete")}
        destructive
        successMessage={t("deleted")}
        onConfirm={(reason) => deletePermissionTemplate({ templateId: deleting!.id, reason })}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}
