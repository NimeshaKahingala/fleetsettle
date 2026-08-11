import { addDays, asBusinessDate, type BusinessDate } from "@fleetsettle/shared";
import { useId, useRef } from "react";
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
  /**
   * M-17's Today/Yesterday chips — right for a single entry date (an
   * expense, a payment) and wrong for a report's own "From"/"To" range
   * endpoint, where "Today" on the *end* of an arbitrary range reads as a
   * non-sequitur and two chip-bearing fields side by side (GAP-83/GAP-105)
   * came to six visible controls for two values. Defaults to `true`,
   * M-17's own default; range/report call sites turn it off explicitly.
   */
  showShortcuts?: boolean;
}

/**
 * §6.3 `DateField` (M-17): Today / Yesterday chips plus the native picker.
 * Shows the weekday — "Tue 30 Jul" is checkable, "30/07" is not.
 *
 * The native `<input type="date">` is the actual click/tap/Tab target,
 * overlaid full-size and `opacity-0` on top of a decorative, `aria-hidden`
 * weekday display — one accessible control, not a visible decoy button
 * plus a second, separately-focusable `sr-only` input behind it (GAP-83:
 * that second input had no visible focus indicator and was still a real Tab
 * stop). Overlaying the real input is also what fixes GAP-105's missing
 * fallback: a browser without `showPicker()` still opens its native date UI
 * on a direct click/focus of a real `<input type="date">`, so `showPicker()`
 * below is only ever a same-tap enhancement, never the only path in.
 */
export function DateField({ label, value, onChange, today, showShortcuts = true }: DateFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
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
      <Label htmlFor={inputId}>{label}</Label>
      {showShortcuts ? (
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
      ) : null}
      <div className="relative min-h-tap rounded-sm focus-within:ring-[3px] focus-within:ring-offset-2 focus-within:ring-focus-ring">
        <div
          aria-hidden="true"
          className="pointer-events-none flex min-h-tap items-center justify-between rounded-sm border border-line-strong px-3 text-body text-ink-primary"
        >
          {formatWeekday(value)}
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="date"
          value={value}
          aria-label={`${label}: ${formatWeekday(value)}, opens a date picker`}
          onChange={(e) => {
            if (e.target.value !== "") onChange(asBusinessDate(e.target.value));
          }}
          onClick={() => {
            if (typeof inputRef.current?.showPicker === "function") {
              inputRef.current.showPicker();
            }
          }}
          className="absolute inset-0 min-h-tap w-full cursor-pointer rounded-sm opacity-0"
        />
      </div>
    </div>
  );
}
