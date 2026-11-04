import type { Json } from "@/types/database";
import { cn } from "@/lib/utils";

function asRecord(value: Json | undefined | null): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Json>) : {};
}

function show(value: Json | undefined): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Before/after viewer with changed keys highlighted (spec §5.22). */
export function JsonDiff({
  before,
  after,
  labels,
}: {
  before: Json | null | undefined;
  after: Json | null | undefined;
  labels: { field: string; before: string; after: string };
}) {
  const b = asRecord(before);
  const a = asRecord(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{labels.field}</th>
            <th className="px-3 py-2 text-left font-medium">{labels.before}</th>
            <th className="px-3 py-2 text-left font-medium">{labels.after}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const changed = JSON.stringify(b[key]) !== JSON.stringify(a[key]);
            return (
              <tr key={key} className={cn("border-t align-top", changed && "bg-warning-soft/60")}>
                <td className="px-3 py-1.5 font-mono font-medium">{key}</td>
                <td className="max-w-64 px-3 py-1.5 font-mono break-all">{show(b[key])}</td>
                <td className="max-w-64 px-3 py-1.5 font-mono break-all">{show(a[key])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
