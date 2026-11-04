import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { Button } from "@/components/ui/button";
import { setNewPassword } from "@/server/actions/auth";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

export const metadata: Metadata = { title: "Set password" };

// Reached from invitation and recovery emails via /auth/confirm, which created the session.
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const [params, t] = await Promise.all([searchParams, getTranslations("auth")]);
  const invite = params.mode === "invite";

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    return (
      <AuthCard title={t("setPasswordTitle")} description={t("linkExpired")}>
        <Button asChild className="w-full">
          <Link href="/forgot-password">{t("sendLink")}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={invite ? t("setPasswordInviteTitle") : t("setPasswordTitle")} description={t("passwordRules")}>
      <SetPasswordForm action={setNewPassword} submitLabel={t("setPassword")} />
    </AuthCard>
  );
}
