import { format, type Minor } from "@fleetsettle/shared";
import { cn } from "../lib/cn.js";

export interface MoneyProps {
  value: Minor;
  className?: string;
  /** Force cents on/off; default is the codec's own rule — shown only when non-zero (M-16). */
  cents?: boolean;
}

/** §6.4 `Money`: tabular, `Rs` prefix, thousands grouped, cents only when non-zero. Never truncated, never abbreviated to "5k". */
export function Money({ value, className, cents }: MoneyProps) {
  return (
    <span className={cn("tabular-nums text-ink-primary", className)}>
      Rs {format(value, cents !== undefined ? { cents } : undefined)}
    </span>
  );
}
