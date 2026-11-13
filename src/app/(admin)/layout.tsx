import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PermissionsProvider } from "@/components/permissions-provider";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { CommandPalette } from "@/components/shell/command-palette";
import { IdleTimeout } from "@/components/shell/idle-timeout";
import { NotificationsMenu } from "@/components/shell/notifications-menu";
import { UserMenu } from "@/components/shell/user-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getAdminContext } from "@/server/auth/context";

// Authoritative gate and app shell for every admin page (docs/spec/06-admin-ui.md §3).
export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const [ctx, cookieStore] = await Promise.all([getAdminContext(), cookies()]);
  if (ctx.mustChangePassword) redirect("/change-password");

  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <PermissionsProvider permissions={[...ctx.permissions]}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <CommandPalette />
              <NotificationsMenu />
              <UserMenu name={ctx.fullName} email={ctx.email} />
            </div>
          </header>
          <main id="main" className="flex-1 space-y-6 p-4 sm:p-6">
            {children}
          </main>
        </SidebarInset>
        <IdleTimeout />
      </SidebarProvider>
    </PermissionsProvider>
  );
}
