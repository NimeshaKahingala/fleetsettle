import { Sheet } from "../design/primitives/Sheet.js";

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
}

/**
 * §6.3 `ReasonPicker`: a single-select list in a `Sheet` — lost-day
 * reasons, adjustment reasons, write-off reasons. FL §4.1: a lost-day
 * `ReasonPicker` never includes "On charter" as an option; that exclusion
 * is the caller's `reasons` list, not something this component enforces.
 */
export function ReasonPicker({ open, onOpenChange, title, reasons, onSelect }: ReasonPickerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <ul className="flex flex-col gap-1 pb-2">
        {reasons.map((reason) => (
          <li key={reason.key}>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onSelect(reason);
              }}
              className="flex min-h-tap w-full items-center rounded-sm px-2 text-body text-ink-primary active:bg-brand-wash"
            >
              {reason.label}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
