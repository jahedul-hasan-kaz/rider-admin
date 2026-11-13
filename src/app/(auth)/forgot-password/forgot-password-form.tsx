"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/server/actions/auth";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await requestPasswordReset({ email });
          setMessage(result.ok ? { text: t("forgotSent"), error: false } : { text: t(result.messageKey), error: true });
        });
      }}
    >
      <FieldGroup>
        {message ? (
          <Alert variant={message.error ? "destructive" : "default"}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        ) : null}
        <Field>
          <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Button type="submit" className="w-full" disabled={pending || !email}>
          {pending ? t("sending") : t("sendLink")}
        </Button>
        <Button asChild variant="link" className="text-muted-foreground">
          <Link href="/login">{t("backToSignIn")}</Link>
        </Button>
      </FieldGroup>
    </form>
  );
}
