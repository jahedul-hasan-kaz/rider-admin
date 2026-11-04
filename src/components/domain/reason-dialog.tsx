"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorKey, fieldErrors, type ActionError } from "@/lib/action-errors";
import type { ActionResult } from "@/server/actions/run";

type Props = {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  /** Plain-language consequence of the action (spec §4.4). */
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Critical actions require typing this word (type-to-confirm). */
  confirmWord?: string;
  presets?: string[];
  successMessage?: string;
  onConfirm: (reason: string) => Promise<ActionResult<unknown>>;
  onSuccess?: () => void;
  children?: ReactNode;
};

/** The only way to run a high-impact action: a required reason, never one click. */
export function ReasonDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  confirmWord,
  presets = [],
  successMessage,
  onConfirm,
  onSuccess,
  children,
}: Props) {
  const t = useTranslations();
  const id = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  const setOpen = (next: boolean) => {
    if (pending) return;
    onOpenChange?.(next);
    setUncontrolledOpen(next);
    if (!next) {
      setReason("");
      setTyped("");
      setError(null);
    }
  };

  const reasonOk = reason.trim().length >= 5;
  const wordOk = !confirmWord || typed.trim() === confirmWord;
  const reasonError = fieldErrors(error).reason;

  function submit() {
    if (!reasonOk || !wordOk) return;
    setError(null);
    startTransition(async () => {
      const result = await onConfirm(reason.trim());
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
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          // Ctrl/⌘ + Enter submits from any field, including the reason box.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        >
          <DialogHeader>
            <span
              className={cn(
                "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                destructive ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
              )}
            >
              {destructive ? (
                <TriangleAlert className="size-3.5" />
              ) : (
                <ShieldCheck className="size-3.5" />
              )}
              {destructive ? t("common.drawerCareful") : t("common.drawerAudited")}
            </span>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {children ? (
              <div className="space-y-4 rounded-xl border bg-muted/30 p-4 duration-300 animate-in fade-in-0 slide-in-from-bottom-2">
                {children}
              </div>
            ) : null}

            {error && !reasonError ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {/* Field messages from the server say exactly what to fix; fall back to the general message. */}
                  {Object.values(fieldErrors(error)).join(" ") ||
                    t(`errors.${errorKey(error.code)}`)}
                </AlertDescription>
              </Alert>
            ) : null}

            <Field data-invalid={Boolean(reasonError) || undefined}>
              <FieldLabel htmlFor={`${id}-reason`}>{t("common.reason")}</FieldLabel>
              {presets.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((p) => (
                    <Button
                      key={p}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={reason === p}
                      className={cn(
                        "h-7 rounded-full transition-all",
                        reason === p && "border-primary bg-primary/10 text-primary",
                      )}
                      onClick={() => setReason(p)}
                    >
                      {reason === p ? <Check className="size-3" /> : null}
                      {p}
                    </Button>
                  ))}
                </div>
              ) : null}
              <Textarea
                id={`${id}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("common.reasonPlaceholder")}
                maxLength={1000}
                rows={3}
                required
                autoFocus
              />
              {reasonError ? (
                <FieldError>{reasonError}</FieldError>
              ) : (
                <FieldDescription className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors",
                      reasonOk && "text-success",
                    )}
                  >
                    {reasonOk ? <Check className="size-3.5" /> : null}
                    {reasonOk ? t("common.reasonOk") : t("common.reasonHelp")}
                  </span>
                  <span className="tabular text-xs">
                    {reason.length}/1000 · {t("common.submitHint")}
                  </span>
                </FieldDescription>
              )}
            </Field>

            {confirmWord ? (
              <Field>
                <FieldLabel htmlFor={`${id}-confirm`}>
                  {t("common.typeToConfirm", { word: confirmWord })}
                </FieldLabel>
                <Input
                  id={`${id}-confirm`}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                />
              </Field>
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
              disabled={!reasonOk || !wordOk || pending}
            >
              {pending ? t("common.saving") : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
