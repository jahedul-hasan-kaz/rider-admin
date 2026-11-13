"use client";

import { Info, Lock, Minus, Plus, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useCan } from "@/components/permissions-provider";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { applyPermissionChanges } from "@/server/actions/admins/permissions";
import type { AdminDetail, Catalogue, CataloguePermission, CatalogueTemplate } from "@/server/queries/admins";

type Override = "grant" | "deny";
type Choice = "default" | Override;

type Props = {
  admin: AdminDetail;
  catalogue: Catalogue;
  canEdit: boolean;
  isSuperAdmin: boolean;
  isSelf: boolean;
};

/**
 * Templates as toggles, then a grouped permission matrix (docs/spec/06-admin-ui.md §5.23).
 * Edits are staged locally and saved atomically with one reason. The database
 * enforces every guardrail; this UI only prevents obviously invalid choices.
 */
export function PermissionEditor({ admin, catalogue, canEdit, isSuperAdmin, isSelf }: Props) {
  const t = useTranslations();
  const can = useCan();
  const router = useRouter();

  const initialTemplates = useMemo(() => new Set(admin.templates.map((x) => x.id)), [admin.templates]);
  const initialOverrides = useMemo(
    () => new Map<string, Override>(admin.overrides.map((o) => [o.permission, o.effect])),
    [admin.overrides],
  );

  // The page remounts this editor (via key) when saved data changes, so staged
  // edits always start from the server state.
  const [templates, setTemplates] = useState(initialTemplates);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(catalogue.templates.map((x) => [x.id, x])), [catalogue.templates]);

  const effective = (tpls: Set<string>, ovr: Map<string, Override>) => {
    const fromTemplates = new Set([...tpls].flatMap((id) => byId.get(id)?.permissions ?? []));
    return new Set(
      catalogue.permissions
        .map((p) => p.code)
        .filter((code) => ovr.get(code) !== "deny" && (fromTemplates.has(code) || ovr.get(code) === "grant")),
    );
  };

  const before = useMemo(() => effective(initialTemplates, initialOverrides), [initialTemplates, initialOverrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = useMemo(() => effective(templates, overrides), [templates, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTemplates = useMemo(
    () => new Set([...templates].flatMap((id) => byId.get(id)?.permissions ?? [])),
    [templates, byId],
  );

  const added = [...after].filter((p) => !before.has(p)).length;
  const removed = [...before].filter((p) => !after.has(p)).length;

  const changes = useMemo(() => {
    const addTemplates = [...templates].filter((id) => !initialTemplates.has(id));
    const removeTemplates = [...initialTemplates].filter((id) => !templates.has(id));
    const codes = new Set([...initialOverrides.keys(), ...overrides.keys()]);
    const overrideChanges = [...codes]
      .filter((code) => initialOverrides.get(code) !== overrides.get(code))
      .map((code) => ({ permission: code, effect: (overrides.get(code) ?? "clear") as Override | "clear" }))
      .filter((c): c is { permission: Parameters<typeof can>[0]; effect: Override | "clear" } => isPermission(c.permission));
    return { addTemplates, removeTemplates, overrides: overrideChanges };
  }, [templates, overrides, initialTemplates, initialOverrides]);

  const dirty = changes.addTemplates.length + changes.removeTemplates.length + changes.overrides.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const holdsAll = (tpl: CatalogueTemplate) => tpl.permissions.every((p) => isPermission(p) && can(p));
  const templateLocked = (tpl: CatalogueTemplate) => {
    if (!canEdit) return true;
    if (tpl.code === "super_admin" && !isSuperAdmin) return true;
    return !templates.has(tpl.id) && !holdsAll(tpl);
  };

  const choiceLocked = (perm: CataloguePermission, choice: Choice) => {
    if (!canEdit) return true;
    if (choice === "grant" && !(isPermission(perm.code) && can(perm.code))) return true;
    if (choice === "deny" && admin.is_super_admin && !isSuperAdmin) return true;
    // Clearing a deny restores access, so it needs the permission too.
    if (choice === "default" && overrides.get(perm.code) === "deny" && !(isPermission(perm.code) && can(perm.code))) return true;
    // Guardrail 3 hint: don't let the editor take admins.manage_permissions from themselves.
    if (isSelf && perm.code === "admins.manage_permissions" && choice === "deny") return true;
    return false;
  };

  const modules = useMemo(() => {
    const map = new Map<string, CataloguePermission[]>();
    for (const p of catalogue.permissions) map.set(p.module, [...(map.get(p.module) ?? []), p]);
    return [...map.entries()];
  }, [catalogue.permissions]);

  function setChoice(code: string, choice: Choice) {
    setOverrides((prev) => {
      const next = new Map(prev);
      if (choice === "default") next.delete(code);
      else next.set(code, choice);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("admins.roleReadOnly")}: Admin</CardTitle>
          <CardDescription>{t("admins.roleHelp")}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("permissions.templatesTitle")}</CardTitle>
          <CardDescription>{t("permissions.templatesHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {catalogue.templates.map((tpl) => {
            const locked = templateLocked(tpl);
            const on = templates.has(tpl.id);
            const control = (
              <label
                htmlFor={`tpl-${tpl.id}`}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                  on && "border-primary/50 bg-primary/5",
                  locked && "opacity-60",
                )}
              >
                <Switch
                  id={`tpl-${tpl.id}`}
                  checked={on}
                  disabled={locked}
                  onCheckedChange={(v) =>
                    setTemplates((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(tpl.id);
                      else next.delete(tpl.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {tpl.name}
                    {locked && canEdit ? <Lock className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("templates.permissionCount", { count: tpl.permissions.length })}
                  </span>
                </span>
              </label>
            );
            return locked && canEdit ? (
              <Tooltip key={tpl.id}>
                <TooltipTrigger asChild>
                  <div>{control}</div>
                </TooltipTrigger>
                <TooltipContent>{t("permissions.locked")}</TooltipContent>
              </Tooltip>
            ) : (
              <div key={tpl.id}>{control}</div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("permissions.matrixTitle")}</CardTitle>
          <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-primary" /> {t("permissions.fromTemplate")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Plus className="size-3 text-success" /> {t("permissions.granted")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Minus className="size-3 text-danger" /> {t("permissions.denied")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Star className="size-3 text-warning" /> {t("permissions.highImpact")}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {modules.map(([module, perms]) => (
            <section key={module} className="px-6 py-4" aria-labelledby={`mod-${module}`}>
              <h3 id={`mod-${module}`} className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {module}
              </h3>
              <ul className="space-y-1">
                {perms.map((perm) => {
                  const override = overrides.get(perm.code);
                  const held = after.has(perm.code);
                  const changed = held !== before.has(perm.code);
                  const choice: Choice = override ?? "default";
                  return (
                    <li
                      key={perm.code}
                      className={cn(
                        "flex flex-col gap-2 rounded-md px-2 py-1.5 sm:flex-row sm:items-center",
                        changed && "bg-warning-soft/50",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full",
                            override === "grant" && "bg-success-soft text-success",
                            override === "deny" && "bg-danger-soft text-danger",
                          )}
                          aria-label={
                            override === "grant"
                              ? t("permissions.granted")
                              : override === "deny"
                                ? t("permissions.denied")
                                : fromTemplates.has(perm.code)
                                  ? t("permissions.fromTemplate")
                                  : t("permissions.notHeld")
                          }
                        >
                          {override === "grant" ? (
                            <Plus className="size-3" />
                          ) : override === "deny" ? (
                            <Minus className="size-3" />
                          ) : fromTemplates.has(perm.code) ? (
                            <span className="size-2 rounded-full bg-primary" />
                          ) : (
                            <span className="size-2 rounded-full border border-muted-foreground/40" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className={cn("text-sm", !held && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                            {perm.description}
                            {perm.is_high_impact ? <Star className="ml-1 inline size-3 text-warning" aria-label={t("permissions.highImpact")} /> : null}
                          </p>
                          <code className="text-xs text-muted-foreground">{perm.code}</code>
                        </div>
                      </div>
                      {canEdit ? (
                        <div className="inline-flex shrink-0 rounded-md border p-0.5" role="radiogroup" aria-label={perm.code}>
                          {(["default", "grant", "deny"] as const).map((c) => {
                            const locked = choiceLocked(perm, c) && choice !== c;
                            return (
                              <button
                                key={c}
                                type="button"
                                role="radio"
                                aria-checked={choice === c}
                                disabled={locked}
                                title={locked ? t("permissions.locked") : undefined}
                                onClick={() => setChoice(perm.code, c)}
                                className={cn(
                                  "rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                                  choice === c && c === "default" && "bg-muted",
                                  choice === c && c === "grant" && "bg-success-soft text-success",
                                  choice === c && c === "deny" && "bg-danger-soft text-danger",
                                )}
                              >
                                {c === "default" ? "—" : t(`permissions.${c}`)}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>

      {canEdit ? (
        <div className="sticky bottom-0 z-30 -mx-4 -mb-4 border-t bg-background/95 backdrop-blur sm:-mx-6 sm:-mb-6">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <p className="flex items-center gap-2 text-sm" aria-live="polite">
              <Info className="size-4 text-muted-foreground" aria-hidden />
              {dirty ? (
                <>
                  <span className="font-medium">{t("permissions.unsavedWarning")}</span>
                  {added > 0 ? <Badge className="bg-success-soft text-success">+{added}</Badge> : null}
                  {removed > 0 ? <Badge className="bg-danger-soft text-danger">−{removed}</Badge> : null}
                </>
              ) : (
                <span className="text-muted-foreground">{t("permissions.noChanges")}</span>
              )}
            </p>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                disabled={!dirty}
                onClick={() => {
                  setTemplates(initialTemplates);
                  setOverrides(initialOverrides);
                }}
              >
                {t("permissions.reset")}
              </Button>
              <Button disabled={!dirty} onClick={() => setSaving(true)}>
                {t("permissions.saveChanges")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ReasonDialog
        open={saving}
        onOpenChange={setSaving}
        title={t("permissions.saveTitle")}
        description={t("permissions.saveBody", { name: admin.full_name })}
        confirmLabel={t("permissions.saveChanges")}
        successMessage={t("permissions.saved")}
        onConfirm={(reason) => applyPermissionChanges({ adminId: admin.id, ...changes, reason })}
        onSuccess={() => router.refresh()}
      >
        <div className="flex gap-2 text-sm">
          {added > 0 ? <Badge className="bg-success-soft text-success">+{added}</Badge> : null}
          {removed > 0 ? <Badge className="bg-danger-soft text-danger">−{removed}</Badge> : null}
        </div>
      </ReasonDialog>
    </div>
  );
}
