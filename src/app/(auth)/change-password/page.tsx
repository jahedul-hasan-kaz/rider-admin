import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { changePassword } from "@/server/actions/auth";
import { getAdminContext } from "@/server/auth/context";
import { safeNextPath } from "@/server/proxy/routes";

export const metadata: Metadata = { title: "Change password" };

// Forced after first sign-in with a shared password (docs/spec/07-security.md §2.4).
// Lives outside the admin layout so that layout's redirect here can't loop.
export default async function ChangePasswordPage({ searchParams }: PageProps<"/change-password">) {
  const [params, t, ctx] = await Promise.all([searchParams, getTranslations("auth"), getAdminContext()]);
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  return (
    <AuthCard
      title={t("changePasswordTitle")}
      description={ctx.mustChangePassword ? t("changePasswordForced") : t("passwordRules")}
    >
      <SetPasswordForm
        action={changePassword}
        submitLabel={t("setPassword")}
        redirectTo={next}
        onSuccessMessage={t("passwordChanged")}
      />
    </AuthCard>
  );
}
