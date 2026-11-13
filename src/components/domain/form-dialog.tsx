"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { errorKey, type ActionError } from "@/lib/action-errors";
import type { ActionResult } from "@/server/actions/run";

type Props = {
  trigger: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  /** Disable the confirm button until the form is complete. */
  valid?: boolean;
  successMessage?: string;
  destructive?: boolean;
  onSubmit: () => Promise<ActionResult<unknown>>;
  onSuccess?: () => void;
  /** Reset the parent's field state when the dialog closes. */
  onClose?: () => void;
  /** Receives the field-level errors of a failed submit. */
  children: (errors: Record<string, string>) => ReactNode;
};

/** A confirm dialog for actions that need input but no reason (cash deposits, transfer references, replies). */
export function FormDialog({
  trigger,
  title,
  description,
  confirmLabel,
  valid = true,
  successMessage,
  destructive,
  onSubmit,
  onSuccess,
  onClose,
  children,
}: Props) {
  const t = useTranslations();
  const [open, setOpenState] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  const setOpen = (next: boolean) => {
    if (pending) return;
    setOpenState(next);
    if (!next) {
      setError(null);
      onClose?.();
    }
  };

  const fields: Record<string, string> = {};
  const raw = error?.details?.fields;
  if (Array.isArray(raw)) {
    for (const f of raw) {
      if (f && typeof f === "object" && "path" in f && "message" in f)
        fields[String(f.path)] = String(f.message);
    }
  }

  function submit() {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const result = await onSubmit();
      if (result.ok) {
        if (successMessage) toast.success(successMessage);
        setOpen(false);
        onSuccess?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <DialogBody>
            {children(fields)}
            {error && Object.keys(fields).length === 0 ? (
              <Alert variant="destructive">
                <AlertDescription>{t(`errors.${errorKey(error.code)}`)}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={!valid || pending}
            >
              {pending ? t("common.saving") : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
