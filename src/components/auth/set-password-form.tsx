"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { PasswordInput, PasswordStrength } from "@/components/auth/password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import type { AuthResult } from "@/server/actions/auth";

type Props = {
  action: (input: unknown) => Promise<AuthResult>;
  submitLabel: string;
  notice?: string;
  /** Overrides the action's redirect (e.g. back to where a forced change interrupted). */
  redirectTo?: string;
  onSuccessMessage?: string;
};

export function SetPasswordForm({ action, submitLabel, notice, redirectTo, onSuccessMessage }: Props) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await action({ password, confirm });
      if (result.ok) {
        setDone(true);
        router.replace((redirectTo ?? result.data.redirectTo) as Route);
        router.refresh();
      } else {
        setError(t(result.messageKey));
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        {notice && !error ? (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {done && onSuccessMessage ? (
          <Alert>
            <AlertDescription>{onSuccessMessage}</AlertDescription>
          </Alert>
        ) : null}
        <Field>
          <FieldLabel htmlFor="new-password">{t("newPassword")}</FieldLabel>
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
          <PasswordStrength password={password} />
          <FieldDescription>{t("passwordRules")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="confirm-password">{t("confirmPassword")}</FieldLabel>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" className="w-full" disabled={pending || !password || !confirm}>
          {pending ? t("verifying") : submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}
