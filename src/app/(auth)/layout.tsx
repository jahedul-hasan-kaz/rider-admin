import { CarFront } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AuthScene } from "@/components/auth/auth-scene";
import { LanguageSwitch } from "@/components/shell/language-switch";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("common");

  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[1.15fr_1fr]">
      {/* Illustrated side (large screens) */}
      <aside className="hidden lg:block">
        <AuthScene />
      </aside>

      <div className="relative flex flex-col overflow-hidden bg-background">
        {/* Decorative glow behind the form */}
        <div className="pointer-events-none absolute -top-32 right-0 size-96 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute bottom-0 -left-24 size-72 rounded-full bg-emerald-300/10 blur-3xl" aria-hidden />

        <header className="relative z-10 flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-md shadow-primary/30">
              <CarFront className="size-4" aria-hidden />
            </span>
            {t("appName")}
          </div>
          <LanguageSwitch />
        </header>
        <main className="relative z-10 flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
