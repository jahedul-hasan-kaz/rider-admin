import type { ReactNode } from "react";
import { KpiHelp } from "@/components/domain/kpi-help";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A labelled figure for the top of finance, care and analytics pages. `help` adds the "?" definition popover. */
export function Stat({
  label,
  children,
  hint,
  tone,
  help,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  tone?: "danger" | "warning" | "success";
  help?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {label}
          {help ? <KpiHelp title={label}>{help}</KpiHelp> : null}
        </p>
        <p className={cn("text-2xl font-semibold tracking-tight tabular", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>
          {children}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>;
}
