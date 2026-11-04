"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { errorKey, fieldErrors } from "@/lib/action-errors";
import { isPermission, type Permission } from "@/lib/permissions";
import { createPermissionTemplate, setTemplatePermissions } from "@/server/actions/admins/permissions";
import type { CataloguePermission, CatalogueTemplate } from "@/server/queries/admins";

export function TemplateEditorDialog({
  template,
  permissions,
  onClose,
  onSaved,
}: {
  template: CatalogueTemplate | null;
  permissions: CataloguePermission[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const id = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(template?.permissions ?? []));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const modules = useMemo(() => {
    const map = new Map<string, CataloguePermission[]>();
    for (const p of permissions) map.set(p.module, [...(map.get(p.module) ?? []), p]);
    return [...map.entries()];
  }, [permissions]);

  function toggle(codes: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  }

  function save() {
    setError(null);
    setFields({});
    const perms = [...selected].filter(isPermission) as Permission[];
    startTransition(async () => {
      const result = template
        ? await setTemplatePermissions({ templateId: template.id, permissions: perms, reason })
        : await createPermissionTemplate({ code, name, description: description || undefined, permissions: perms, reason });
      if (result.ok) {
        toast.success(template ? t("templates.updated") : t("templates.created"));
        onSaved();
      } else {
        const f = fieldErrors(result.error);
        setFields(f);
        if (Object.keys(f).length === 0) setError(t(`errors.${errorKey(result.error.code)}`));
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? t("templates.editTitle", { name: template.name }) : t("templates.createTitle")}</DialogTitle>
          <DialogDescription>
            {template ? t("templates.impact", { count: template.admin_count }) : t("permissions.templatesHelp")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup className="gap-4">
          {!template ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(fields.code) || undefined}>
                <FieldLabel htmlFor={`${id}-code`}>{t("templates.code")}</FieldLabel>
                <Input id={`${id}-code`} value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="night_ops" />
                {fields.code ? <FieldError>{fields.code}</FieldError> : <FieldDescription>{t("templates.codeHelp")}</FieldDescription>}
              </Field>
              <Field data-invalid={Boolean(fields.name) || undefined}>
                <FieldLabel htmlFor={`${id}-name`}>{t("templates.name")}</FieldLabel>
                <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
                {fields.name ? <FieldError>{fields.name}</FieldError> : null}
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={`${id}-desc`}>{t("templates.description")}</FieldLabel>
                <Input id={`${id}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
          ) : null}

          <ScrollArea className="h-80 rounded-md border">
            <div className="divide-y">
              {modules.map(([module, perms]) => {
                const codes = perms.map((p) => p.code);
                const all = codes.every((c) => selected.has(c));
                const some = !all && codes.some((c) => selected.has(c));
                return (
                  <fieldset key={module} className="space-y-1.5 p-3">
                    <legend className="sr-only">{module}</legend>
                    <label className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(v) => toggle(codes, v === true)} />
                      {module}
                    </label>
                    <div className="grid gap-1 pl-6 sm:grid-cols-2">
                      {perms.map((p) => (
                        <label key={p.code} className="flex items-start gap-2 text-sm">
                          <Checkbox className="mt-0.5" checked={selected.has(p.code)} onCheckedChange={(v) => toggle([p.code], v === true)} />
                          <span>
                            {p.description}
                            {p.is_high_impact ? <Star className="ml-1 inline size-3 text-warning" aria-label={t("permissions.highImpact")} /> : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </ScrollArea>

          <Field data-invalid={Boolean(fields.reason) || undefined}>
            <FieldLabel htmlFor={`${id}-reason`}>{t("common.reason")}</FieldLabel>
            <Textarea id={`${id}-reason`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("common.reasonPlaceholder")} />
            {fields.reason ? <FieldError>{fields.reason}</FieldError> : <FieldDescription>{t("common.reasonHelp")}</FieldDescription>}
          </Field>
        </FieldGroup>

        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={pending || reason.trim().length < 5 || (!template && (!code || !name))}>
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
