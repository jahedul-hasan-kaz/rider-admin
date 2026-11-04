import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { isPermission } from "@/lib/permissions";
import { getAdminContext } from "@/server/auth/context";
import { getCatalogue } from "@/server/queries/admins";
import { ProfileForm } from "./profile-form";
import { TwoFactorCard } from "./two-factor-card";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const [ctx, t, locale] = await Promise.all([getAdminContext(), getTranslations("profile"), getLocale()]);
  const catalogue = await getCatalogue(ctx);
  const mine = catalogue.permissions.filter((p) => isPermission(p.code) && ctx.permissions.has(p.code));

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("details")}</CardTitle>
            <CardDescription>{ctx.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm fullName={ctx.fullName} preferredLanguage={ctx.preferredLanguage} version={ctx.version} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("security")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <TwoFactorCard
              enabled={ctx.mfaEnabled}
              required={ctx.mfaRequired}
              since={ctx.mfaEnrolledAt ? formatDate(ctx.mfaEnrolledAt, locale) : null}
            />
            <Button asChild variant="outline">
              <Link href="/change-password?next=/profile">
                <KeyRound className="size-4" />
                {t("changePassword")}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("permissionsTitle")}</CardTitle>
            <CardDescription>{t("permissionsCount", { count: mine.length })}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {mine.map((p) => (
              <Badge key={p.code} variant="secondary" title={p.description}>
                {p.code}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
