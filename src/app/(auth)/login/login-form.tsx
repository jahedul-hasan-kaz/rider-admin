"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CircleCheck, Loader2, Lock, Mail, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { PasswordInput } from "@/components/auth/password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { signIn } from "@/server/actions/auth";

const schema = z.object({ email: z.email(), password: z.string().min(1) });

export function LoginForm({ next, notice, noticeIsError }: { next?: string; notice?: string; noticeIsError: boolean }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const [email, password] = useWatch({ control: form.control, name: ["email", "password"] });
  const emailOk = schema.shape.email.safeParse(email).success;
  const [capsLock, setCapsLock] = useState(false);
  const ready = emailOk && password.length > 0;

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const result = await signIn({ ...values, next });
      if (result.ok) {
        router.replace(result.data.redirectTo as Route);
        router.refresh();
      } else {
        setError(t(result.messageKey));
        form.setValue("password", "");
        form.setFocus("password");
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {error || notice ? (
          <Alert variant={error || noticeIsError ? "destructive" : "default"}>
            <AlertDescription>{error ?? notice}</AlertDescription>
          </Alert>
        ) : null}
        <Field data-invalid={Boolean(form.formState.errors.email) || undefined}>
          <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
          <div className="group relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <Input id="email" type="email" autoComplete="username" autoFocus required className="h-11 pr-10 pl-9 transition-shadow focus-visible:shadow-md focus-visible:shadow-primary/10" placeholder="name@company.com" {...form.register("email")} />
            <CircleCheck className={cn("pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-success transition-opacity", emailOk ? "opacity-100" : "opacity-0")} aria-hidden />
          </div>
        </Field>
        <Field data-invalid={Boolean(form.formState.errors.password) || undefined}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
            <Link href="/forgot-password" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
              {t("forgotPassword")}
            </Link>
          </div>
          <div className="group relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <PasswordInput
              id="password"
              autoComplete="current-password"
              required
              className="h-11 pl-9 transition-shadow focus-visible:shadow-md focus-visible:shadow-primary/10"
              onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
              {...form.register("password")}
            />
          </div>
          {capsLock ? (
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <TriangleAlert className="size-3.5" />
              {t("capsLockOn")}
            </p>
          ) : null}
        </Field>
        <Button type="submit" className="group h-11 w-full text-base shadow-md shadow-primary/20 transition-all hover:shadow-lg hover:shadow-primary/30 active:scale-[0.99]" disabled={pending || !ready}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? t("signingIn") : t("signIn")}
          {pending ? null : <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
        </Button>
      </FieldGroup>
    </form>
  );
}
