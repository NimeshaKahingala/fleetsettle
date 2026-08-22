import { Info } from "lucide-react";
import { cn } from "../lib/cn.js";
import { rowButtonFocus } from "../lib/rowButtonFocus.js";

export interface NotAvailableProps {
  /** e.g. "no closing odometer" — the reason is mandatory; there is no bare em-dash. */
  reason: string;
  onInfo?: () => void;
  className?: string;
}

/**
 * §6.4 `NotAvailable` (M-13, W-56): renders the em-dash with a caption
 * saying *why*, never a bare `0` — a confident wrong number is worse than
 * an admitted gap. `aria-label` carries the meaning for assistive tech,
 * since an em-dash alone reads as punctuation, not as "data unavailable".
 */
export function NotAvailable({ reason, onInfo, className }: NotAvailableProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-ink-muted", className)}
      aria-label={`Not available: ${reason}`}
    >
      <span aria-hidden>—</span>
      <span className="text-caption">{reason}</span>
      {onInfo !== undefined ? (
        <button
          type="button"
          aria-label={`Why is this not available? ${reason}`}
          onClick={onInfo}
          className={cn(
            "flex size-tap items-center justify-center rounded-sm active:bg-brand-wash",
            rowButtonFocus,
          )}
        >
          <Info className="size-4" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
