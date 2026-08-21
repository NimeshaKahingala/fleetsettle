import { QueryStateFailure } from "./QueryState.js";
import { Sheet } from "../design/primitives/Sheet.js";
import { cn } from "../lib/cn.js";
import { rowButtonFocus } from "../lib/rowButtonFocus.js";

export interface ReasonOption {
  key: string;
  label: string;
}

export interface ReasonPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  reasons: ReasonOption[];
  onSelect: (reason: ReasonOption) => void;
  /** GAP-101: when `reasons` is fed by a query that failed, renders the failure in place of the (otherwise indistinguishable) empty list. The other call sites — static reason lists — never pass this. */
  error?: { error: unknown; retry: () => void; of: string };
  /** GAP-125/GAP-101: when `reasons` is fed by a query still in flight, renders a loading notice in place of the same otherwise-indistinguishable empty list. An `enabled`-gated query (the common shape for a picker's own data) only starts fetching once this sheet opens, so every open has a real fetch window, not just a slow one — confirmed live 14 Aug 2026, cold cache under Slow 4G held the picker at zero rows for 500-800ms. Static reason lists never pass this. */
  pending?: boolean;
}

/**
 * §6.3 `ReasonPicker`: a single-select list in a `Sheet` — lost-day
 * reasons, adjustment reasons, write-off reasons. FL §4.1: a lost-day
 * `ReasonPicker` never includes "On charter" as an option; that exclusion
 * is the caller's `reasons` list, not something this component enforces.
 */
export function ReasonPicker({
  open,
  onOpenChange,
  title,
  reasons,
  onSelect,
  error,
  pending = false,
}: ReasonPickerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      {error !== undefined ? (
        <QueryStateFailure error={error.error} retry={error.retry} of={error.of} />
      ) : pending ? (
        <p className="text-body text-ink-muted">Loading…</p>
      ) : (
        <ul className="flex flex-col gap-1 pb-2">
          {reasons.map((reason) => (
            <li key={reason.key}>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onSelect(reason);
                }}
                className={cn(
                  "flex min-h-tap w-full items-center rounded-sm px-2 text-body text-ink-primary active:bg-brand-wash",
                  rowButtonFocus,
                )}
              >
                {reason.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
