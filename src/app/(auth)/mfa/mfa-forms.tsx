"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { CopyButton } from "@/components/domain/copy-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut, startMfaEnrollment, verifyMfa, type MfaEnrollment } from "@/server/actions/auth";

function CodeForm({ factorId, enrolling, next }: { factorId: string; enrolling: boolean; next: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitted = useRef<string | null>(null);

  function submit(value: string) {
    if (value.length !== 6 || submitted.current === value) return;
    submitted.current = value;
    setError(null);
    startTransition(async () => {
      const result = await verifyMfa({ factorId, code: value, enrolling, next });
      if (result.ok) {
        router.replace(result.data.redirectTo as Route);
        router.refresh();
      } else {
        setError(t(result.messageKey));
        setCode("");
        submitted.current = null;
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(code);
      }}
    >
      <FieldGroup>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Field>
          <FieldLabel htmlFor="mfa-code">{t("mfaCode")}</FieldLabel>
          <InputOTP
            id="mfa-code"
            maxLength={6}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (v.length === 6) submit(v); // auto-submit; paste works too
            }}
            inputMode="numeric"
            pattern="^[0-9]*$"
            autoComplete="one-time-code"
            autoFocus
            disabled={pending}
            containerClassName="justify-center"
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </Field>
        <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
          {pending ? t("verifying") : t("verify")}
        </Button>
        <SwitchAccount />
      </FieldGroup>
    </form>
  );
}

function SwitchAccount() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="link"
      className="text-muted-foreground"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await signOut();
          if (result.ok) router.replace(result.data.redirectTo as Route);
        })
      }
    >
      {t("useDifferentAccount")}
    </Button>
  );
}

export function MfaChallenge({ factorId, next }: { factorId: string; next: string }) {
  return <CodeForm factorId={factorId} enrolling={false} next={next} />;
}

export function MfaEnroll({ next }: { next: string }) {
  const t = useTranslations("auth");
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startMfaEnrollment().then((result) => {
      if (result.ok) setEnrollment(result.data);
      else setError(t(result.messageKey));
    });
  }, [t]);

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <SwitchAccount />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="space-y-4 text-sm">
        <li className="space-y-3">
          <p>
            <span className="font-medium">1.</span> {t("mfaStep1")}
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
              <p className="text-xs text-muted-foreground">{t("mfaManualKey")}</p>
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
            <span className="font-medium">2.</span> {t("mfaStep2")}
          </p>
        </li>
      </ol>
      {enrollment ? <CodeForm factorId={enrollment.factorId} enrolling next={next} /> : null}
    </div>
  );
}
