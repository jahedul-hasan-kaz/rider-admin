import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { safeNextPath } from "@/server/proxy/routes";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { MfaChallenge, MfaEnroll } from "./mfa-forms";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function MfaPage({ searchParams }: PageProps<"/mfa">) {
  const [params, t] = await Promise.all([searchParams, getTranslations("auth")]);
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp.find((f) => f.status === "verified");

  // Two-factor is optional: without a factor there is nothing to verify, so go on (unless the organisation requires it,
  // in which case set-up is shown).
  if (!verified) {
    const { data: ctx } = await supabase.schema("api").rpc("my_admin_context");
    const required = typeof ctx === "object" && ctx !== null && !Array.isArray(ctx) && (ctx as Record<string, unknown>).mfa_required === true;
    if (!required) redirect(next as Route);
  }

  return verified ? (
    <AuthCard title={t("mfaChallengeTitle")} description={t("mfaChallengeBody")}>
      <MfaChallenge factorId={verified.id} next={next} />
    </AuthCard>
  ) : (
    <AuthCard title={t("mfaEnrollTitle")} description={t("mfaEnrollBody")}>
      <MfaEnroll next={next} />
    </AuthCard>
  );
}
