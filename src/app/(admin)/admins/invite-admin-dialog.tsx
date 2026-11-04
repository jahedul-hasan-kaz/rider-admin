"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lock, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { useCan } from "@/components/permissions-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody, DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorKey, fieldErrors } from "@/lib/action-errors";
import { isPermission } from "@/lib/permissions";
import { inviteAdminSchema } from "@/lib/schemas/admins";
import { inviteAdmin } from "@/server/actions/admins/invitations";
import type { CatalogueTemplate } from "@/server/queries/admins";

type FormValues = z.input<typeof inviteAdminSchema>;

export function InviteAdminDialog({
  templates,
  isSuperAdmin,
  canAssignTemplates,
}: {
  templates: CatalogueTemplate[];
  isSuperAdmin: boolean;
  canAssignTemplates: boolean;
}) {
  const t = useTranslations();
  const can = useCan();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(inviteAdminSchema),
    defaultValues: { email: "", fullName: "", templateIds: [], reason: "" },
  });

  // Guardrail 1 in the UI: only templates whose permissions the inviter holds.
  const assignable = (tpl: CatalogueTemplate) =>
    canAssignTemplates &&
    (tpl.code !== "super_admin" || isSuperAdmin) &&
    tpl.permissions.every((p) => isPermission(p) && can(p));

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const result = await inviteAdmin(values);
      if (result.ok) {
        toast.success(t("admins.inviteSent", { email: values.email }));
        setOpen(false);
        form.reset();
        router.refresh();
        return;
      }
      const fields = fieldErrors(result.error);
      for (const [path, message] of Object.entries(fields)) {
        const key = path === "full_name" ? "fullName" : path;
        if (key in form.getValues()) form.setError(key as keyof FormValues, { message });
      }
      if (Object.keys(fields).length === 0) setError(t(`errors.${errorKey(result.error.code)}`));
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        setOpen(o);
        if (!o) {
          form.reset();
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" />
          {t("admins.invite")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("admins.inviteTitle")}</DialogTitle>
            <DialogDescription>{t("admins.inviteBody")}</DialogDescription>
          </DialogHeader>
          <DialogBody>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field data-invalid={Boolean(form.formState.errors.fullName) || undefined}>
              <FieldLabel htmlFor="invite-name">{t("admins.fullName")}</FieldLabel>
              <Input id="invite-name" autoComplete="off" autoFocus {...form.register("fullName")} />
              <FieldError errors={[form.formState.errors.fullName]} />
            </Field>
            <Field data-invalid={Boolean(form.formState.errors.email) || undefined}>
              <FieldLabel htmlFor="invite-email">{t("auth.email")}</FieldLabel>
              <Input id="invite-email" type="email" autoComplete="off" {...form.register("email")} />
              <FieldError errors={[form.formState.errors.email]} />
            </Field>
            {canAssignTemplates ? (
              <FieldSet>
                <FieldLegend variant="label">{t("admins.templatesLabel")}</FieldLegend>
                <FieldDescription>{t("admins.templatesHelp")}</FieldDescription>
                <Controller
                  control={form.control}
                  name="templateIds"
                  render={({ field }) => (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {templates.map((tpl) => {
                        const enabled = assignable(tpl);
                        const checked = (field.value ?? []).includes(tpl.id);
                        const row = (
                          <label
                            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:disabled]:opacity-50"
                            htmlFor={`tpl-${tpl.id}`}
                          >
                            <Checkbox
                              id={`tpl-${tpl.id}`}
                              checked={checked}
                              disabled={!enabled}
                              onCheckedChange={(v) =>
                                field.onChange(
                                  v ? [...(field.value ?? []), tpl.id] : (field.value ?? []).filter((id) => id !== tpl.id),
                                )
                              }
                            />
                            <span className="flex-1">{tpl.name}</span>
                            {!enabled ? <Lock className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                          </label>
                        );
                        return enabled ? (
                          <div key={tpl.id}>{row}</div>
                        ) : (
                          <Tooltip key={tpl.id}>
                            <TooltipTrigger asChild>
                              <div>{row}</div>
                            </TooltipTrigger>
                            <TooltipContent>{t("permissions.locked")}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  )}
                />
              </FieldSet>
            ) : null}
            <Field data-invalid={Boolean(form.formState.errors.reason) || undefined}>
              <FieldLabel htmlFor="invite-reason">{t("common.reason")}</FieldLabel>
              <Textarea id="invite-reason" rows={2} placeholder={t("common.reasonPlaceholder")} {...form.register("reason")} />
              <FieldError errors={[form.formState.errors.reason]} />
            </Field>
          </FieldGroup>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("auth.sending") : t("admins.sendInvite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
