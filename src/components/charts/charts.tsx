import { cn } from "@/lib/utils";

// Small dependency-free SVG charts. Colours come from the theme tokens, so light and dark both work, and every
// chart carries a text alternative (aria-label plus a visually hidden data table where the values matter).

export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <div className={cn("h-8 w-24 rounded bg-muted/50", className)} role="img" aria-label={label} />;
  }
  const w = 96;
  const h = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-24 text-primary", className)} role="img" aria-label={label}>
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

type Series = { name: string; values: number[]; className: string };

/** Vertical bars, one group per label. Up to three series, drawn side by side. */
export function BarChart({
  labels,
  series,
  height = 160,
  format = (n) => String(n),
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const groupW = 100 / Math.max(labels.length, 1);
  const barW = Math.min(groupW * 0.8, 9) / series.length;
  const step = Math.ceil(labels.length / 8);
  return (
    <div>
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2="100" y1={(height / 4) * (1 - f)} y2={(height / 4) * (1 - f)} className="stroke-border" strokeWidth="0.15" vectorEffect="non-scaling-stroke" />
        ))}
        {labels.map((label, i) =>
          series.map((s, k) => {
            const v = s.values[i] ?? 0;
            const bh = (v / max) * (height / 4 - 1);
            const x = i * groupW + (groupW - barW * series.length) / 2 + k * barW;
            return (
              <rect key={`${label}-${s.name}`} x={x} y={height / 4 - bh} width={barW} height={bh} rx="0.3" className={s.className}>
                <title>{`${label} · ${s.name}: ${format(v)}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground" aria-hidden>
        {labels.map((l, i) => (i % step === 0 ? <span key={l + i}>{l}</span> : <span key={l + i} />))}
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th />
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l + i}>
              <th>{l}</th>
              {series.map((s) => (
                <td key={s.name}>{format(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {series.length > 1 ? (
        <ul className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-sm", s.className.replace("fill-", "bg-"))} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Horizontal funnel: each step as a bar relative to the first, with the drop-off from the previous step. */
export function FunnelBars({ steps, dropLabel }: { steps: { label: string; value: number }[]; dropLabel: (pct: number) => string }) {
  const top = Math.max(steps[0]?.value ?? 0, 1);
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1]!.value : null;
        const drop = prev && prev > 0 ? Math.round(((prev - s.value) / prev) * 1000) / 10 : null;
        return (
          <li key={s.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="tabular text-muted-foreground">
                {s.value.toLocaleString()}
                {drop !== null && drop > 0 ? <span className="ml-2 text-xs text-warning">{dropLabel(drop)}</span> : null}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={s.value} aria-valuemin={0} aria-valuemax={top} aria-label={s.label}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${(s.value / top) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A simple labelled share bar list (cancellation reasons, rating distribution, match-time buckets). */
export function ShareBars({ items, total }: { items: { label: string; value: number; className?: string }[]; total?: number }) {
  const sum = total ?? items.reduce((s, i) => s + i.value, 0);
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label} className="space-y-1">
          <div className="flex justify-between gap-2 text-sm">
            <span>{i.label}</span>
            <span className="tabular text-muted-foreground">
              {i.value.toLocaleString()}
              {sum > 0 ? ` · ${Math.round((i.value / sum) * 100)}%` : ""}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", i.className ?? "bg-primary")} style={{ width: `${sum > 0 ? (i.value / sum) * 100 : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
