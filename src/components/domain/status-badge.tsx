import { CircleCheck, CircleDashed, CircleDot, CircleMinus, CircleX, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "success" | "info" | "warning" | "danger" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-neutral-soft text-neutral",
};

const TONE_ICON: Record<Tone, LucideIcon> = {
  success: CircleCheck,
  info: CircleDot,
  warning: CircleDashed,
  danger: CircleX,
  neutral: CircleMinus,
};

// Status → tone semantics from docs/spec/06-admin-ui.md §2.
const STATUS_TONE: Record<string, Tone> = {
  active: "success",
  approved: "success",
  completed: "success",
  paid: "success",
  succeeded: "success",
  processed: "success",
  verified: "success",
  resolved: "success",
  applied: "success",
  low: "neutral",
  accepted: "success",
  searching: "info",
  in_progress: "info",
  processing: "info",
  under_review: "info",
  pending: "warning",
  awaiting_second_approval: "warning",
  pending_user: "warning",
  open: "warning",
  reserved: "warning",
  draft: "neutral",
  paused: "warning",
  normal: "info",
  medium: "warning",
  high: "danger",
  urgent: "danger",
  reported: "danger",
  escalated: "danger",
  acknowledged: "info",
  investigating: "info",
  partially_refunded: "info",
  refunded: "neutral",
  released: "neutral",
  submitted: "warning",
  requested: "warning",
  expiring: "warning",
  suspended: "danger",
  rejected: "danger",
  failed: "danger",
  critical: "danger",
  expired: "danger",
  deactivated: "neutral",
  cancelled: "neutral",
  closed: "neutral",
  retired: "neutral",
  offline: "neutral",
};

export function toneFor(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

/** Colour is always paired with an icon and a text label (never colour alone). */
export function StatusBadge({ status, label, className }: { status: string; label: string; className?: string }) {
  const tone = toneFor(status);
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
