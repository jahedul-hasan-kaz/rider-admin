import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TimelineItem = {
  id: string | number;
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
  tone?: "default" | "danger" | "success";
};

/** Chronological list used on the request and trip pages. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative space-y-5 border-l pl-6">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            className={cn(
              "absolute top-1.5 -left-[29px] size-2.5 rounded-full border-2 border-background",
              item.tone === "danger" ? "bg-danger" : item.tone === "success" ? "bg-success" : "bg-primary",
            )}
            aria-hidden
          />
          <div className="text-sm font-medium">{item.title}</div>
          {item.meta ? <div className="text-xs text-muted-foreground">{item.meta}</div> : null}
          {item.body ? <div className="mt-1 text-sm">{item.body}</div> : null}
        </li>
      ))}
    </ol>
  );
}
