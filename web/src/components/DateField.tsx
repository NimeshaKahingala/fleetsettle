import { addDays, asBusinessDate, type BusinessDate } from "@fleetsettle/shared";
import { useRef } from "react";
import { Label } from "../design/primitives/Label.js";
import { cn } from "../lib/cn.js";

const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Business dates are calendar dates with no time — formatted as UTC midnight so no device timezone can shift the day (CLAUDE.md → Time). */
function formatWeekday(date: BusinessDate): string {
  return weekdayFormatter.format(new Date(`${date}T00:00:00Z`));
}

export interface DateFieldProps {
  label: string;
  value: BusinessDate;
  onChange: (value: BusinessDate) => void;
  /** Injected — never read from the device clock here (CLAUDE.md → Time); the caller computes it via the business timezone. */
  today: BusinessDate;
}

/**
 * §6.3 `DateField` (M-17): Today / Yesterday chips plus the native picker.
 * Shows the weekday — "Tue 30 Jul" is checkable, "30/07" is not. The
 * native `<input type="date">` is visually hidden but still reachable via
 * `showPicker()`; the OS calendar overlay it opens doesn't depend on the
 * hidden input's own box size.
 */
export function DateField({ label, value, onChange, today }: DateFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const yesterday = addDays(today, -1);

  function chipClass(selected: boolean): string {
    return cn(
      "min-h-tap rounded-sm border px-3 text-body",
      selected
        ? "border-brand bg-brand-wash text-brand-ink"
        : "border-line-strong text-ink-primary",
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={value === today}
          className={chipClass(value === today)}
          onClick={() => onChange(today)}
        >
          Today
        </button>
        <button
          type="button"
          aria-pressed={value === yesterday}
          className={chipClass(value === yesterday)}
          onClick={() => onChange(yesterday)}
        >
          Yesterday
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          if (typeof inputRef.current?.showPicker === "function") {
            inputRef.current.showPicker();
          }
        }}
        className="flex min-h-tap items-center justify-between rounded-sm border border-line-strong px-3 text-body text-ink-primary"
      >
        {formatWeekday(value)}
      </button>
      <input
        ref={inputRef}
        type="date"
        className="sr-only"
        value={value}
        aria-label={`${label} (calendar picker)`}
        onChange={(e) => {
          if (e.target.value !== "") onChange(asBusinessDate(e.target.value));
        }}
      />
    </div>
  );
}
