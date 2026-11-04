"use client";

import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/domain/copy-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Skeleton } from "@/components/ui/skeleton";
import { disableMfa, startMfaEnrollment, verifyMfa, type MfaEnrollment } from "@/server/actions/auth";

function CodeInput({ value, onChange, disabled, onComplete }: { value: string; onChange: (v: string) => void; disabled: boolean; onComplete: (code: string) => void }) {
  const t = useTranslations("auth");
  return (
    <Field>
      <FieldLabel htmlFor="tf-code">{t("mfaCode")}</FieldLabel>
      <InputOTP
        id="tf-code"
        maxLength={6}
        value={value}
        onChange={(v) => {
          onChange(v);
          if (v.length === 6) onComplete(v);
        }}
        inputMode="numeric"
        pattern="^[0-9]*$"
        autoComplete="one-time-code"
        autoFocus
        disabled={disabled}
        containerClassName="justify-center"
      >
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </Field>
  );
}

/** Profile → Security: turn two-factor authentication on or off. Optional unless the organisation requires it. */
export function TwoFactorCard({ enabled, required, since }: { enabled: boolean; required: boolean; since: string | null }) {
  const t = useTranslations("profile");
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  // Turning on: ask the auth service for a fresh secret and QR as soon as the drawer opens.
  useEffect(() => {
    // Once per opening: a second concurrent request would remove the first one's (still unverified) factor.
    if (!open || enabled || started.current) return;
    started.current = true;
    startMfaEnrollment().then((res) => {
      if (res.ok) setEnrollment(res.data);
      else setError(tAuth(res.messageKey));
    });
  }, [open, enabled, tAuth]);

  function close(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      started.current = false;
      setCode("");
      setError(null);
      setEnrollment(null);
    }
  }

  function submit(value = code) {
    if (value.length !== 6 || pending) return;
    setError(null);
    startTransition(async () => {
      const res = enabled
        ? await disableMfa({ code: value })
        : enrollment
          ? await verifyMfa({ factorId: enrollment.factorId, code: value, enrolling: true, next: "/profile" })
          : null;
      if (!res) return;
      if (res.ok) {
        toast.success(enabled ? t("mfaTurnedOff") : t("mfaTurnedOn"));
        close(false);
        router.refresh();
      } else {
        setError(tAuth(res.messageKey));
        setCode("");
      }
    });
  }

  return (
    <>
      <div className={enabled ? "flex items-start gap-3 rounded-lg border p-3" : "flex items-start gap-3 rounded-lg border border-dashed p-3"}>
        {enabled ? <ShieldCheck className="mt-0.5 size-5 text-success" aria-hidden /> : <ShieldOff className="mt-0.5 size-5 text-muted-foreground" aria-hidden />}
        <div className="flex-1 space-y-1 text-sm">
          <p className="font-medium">{enabled ? t("mfaEnabled") : t("mfaDisabled")}</p>
          <p className="text-muted-foreground">
            {enabled ? (since ? t("mfaSinceShort", { date: since }) : t("mfaEnabledBody")) : required ? t("mfaRequiredSetup") : t("mfaDisabledBody")}
          </p>
          {required && enabled ? <p className="text-xs text-muted-foreground">{t("mfaRequiredNote")}</p> : null}
        </div>
        {enabled && required ? null : (
          <Button variant={enabled ? "outline" : "default"} size="sm" onClick={() => setOpen(true)}>
            {enabled ? t("mfaTurnOff") : t("mfaTurnOn")}
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{enabled ? t("mfaTurnOffTitle") : t("mfaTurnOnTitle")}</DialogTitle>
              <DialogDescription>{enabled ? t("mfaTurnOffBody") : t("mfaTurnOnBody")}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {enabled ? null : (
                <ol className="space-y-4 text-sm">
                  <li className="space-y-3">
                    <p>
                      <span className="font-medium">1.</span> {tAuth("mfaStep1")}
                    </p>
                    <div className="flex justify-center">
                      {enrollment ? (
                        // QR is an inline SVG data URI from Supabase Auth; nothing is fetched.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={enrollment.qrCode} alt="QR code" width={176} height={176} className="rounded-md border bg-white p-2" />
                      ) : (
                        <Skeleton className="size-44" />
                      )}
                    </div>
                    {enrollment ? (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{tAuth("mfaManualKey")}</p>
                        <div className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                          <code className="flex-1 font-mono text-xs break-all" data-testid="mfa-secret">
                            {enrollment.secret}
                          </code>
                          <CopyButton value={enrollment.secret} />
                        </div>
                      </div>
                    ) : null}
                  </li>
                  <li>
                    <p>
                      <span className="font-medium">2.</span> {tAuth("mfaStep2")}
                    </p>
                  </li>
                </ol>
              )}
              {enabled || enrollment ? <CodeInput value={code} onChange={setCode} disabled={pending} onComplete={(v) => submit(v)} /> : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" variant={enabled ? "destructive" : "default"} disabled={pending || code.length !== 6}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {enabled ? t("mfaTurnOff") : t("mfaTurnOn")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
