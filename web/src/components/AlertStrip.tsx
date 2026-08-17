import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface AlertStripProps {
  severity: "warning" | "critical";
  icon: LucideIcon;
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * §6.4 `AlertStrip` (Home items 1–2, M-9): full-bleed, never a `Card` — §3.2
 * is explicit that these "are not cards; they must not be mistaken for
 * work." The warning/critical wash is the same 15%-opacity treatment
 * `SyncChip`/`OfflineBanner` already use for warning, extended to critical
 * rather than inventing a second visual language for the same kind of fact.
 */
export function AlertStrip({ severity, icon: Icon, children, action, className }: AlertStripProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 px-4 py-3",
        severity === "critical"
          ? "bg-critical/15 text-critical-ink"
          : "bg-warning/15 text-warning-ink",
        className,
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-body-sm">{children}</p>
      {action !== undefined ? (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 text-body-sm font-medium underline underline-offset-2"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
