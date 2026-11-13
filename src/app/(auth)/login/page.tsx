import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICE_KEYS: Record<string, string> = {
  forbidden: "forbidden",
  suspended: "suspended",
  idle: "idle",
  signed_out: "signedOut",
  link_expired: "linkExpired",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const [params, t] = await Promise.all([searchParams, getTranslations("auth")]);
  const code = typeof params.error === "string" ? params.error : typeof params.reason === "string" ? params.reason : "";
  const noticeKey = NOTICE_KEYS[code];
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <AuthCard title={t("signInTitle")} description={t("signInSubtitle")}>
      <LoginForm next={next} notice={noticeKey ? t(noticeKey) : undefined} noticeIsError={code !== "signed_out" && code !== "idle"} />
    </AuthCard>
  );
}
