import { SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/domain/empty-state";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <EmptyState
      icon={SearchX}
      title={t("notFoundTitle")}
      description={t("notFoundBody")}
      action={
        <Button asChild variant="outline">
          <Link href="/dashboard">{t("goToDashboard")}</Link>
        </Button>
      }
      className="min-h-[60vh]"
    />
  );
}
