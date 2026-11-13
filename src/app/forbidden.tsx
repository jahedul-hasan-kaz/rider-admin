import { ShieldX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/domain/empty-state";
import { Button } from "@/components/ui/button";

export default async function Forbidden() {
  const t = await getTranslations("common");
  return (
    <EmptyState
      icon={ShieldX}
      title={t("forbiddenTitle")}
      description={t("forbiddenBody")}
      action={
        <Button asChild variant="outline">
          <Link href="/dashboard">{t("goToDashboard")}</Link>
        </Button>
      }
      className="min-h-[60vh]"
    />
  );
}
