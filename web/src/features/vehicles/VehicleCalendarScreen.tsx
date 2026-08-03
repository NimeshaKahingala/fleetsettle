import {
  addCalendarMonths,
  addDays,
  monthEnd,
  monthStart,
  weekdayOf,
  type BusinessDate,
} from "@fleetsettle/shared";
import type { VehicleCalendarDay, VehicleResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";

export interface VehicleCalendarScreenProps {
  vehicleId: string;
  onBack: () => void;
  /** Injected — never read from the device clock here (CLAUDE.md → Time); `createAppRouteTree`'s own `today` is threaded down through the route, the same way `VehicleListScreen` (this feature's sibling) already takes it. */
  today: BusinessDate;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

interface CellStyle {
  wash: string;
  glyph: string;
}

/**
 * UI §7.6's seven-row table, plus one addition it doesn't cover: an
 * arrangement-B day that's scheduled but not yet confirmed (`open` — the
 * common case, since day-card-generation.ts's 90-day rolling horizon means
 * most of a month's daily-lease days are still `open` at the time anyone
 * looks) or mid-pause (`paused_for_trip`, likely unreachable in practice —
 * a paused day's own date almost always already shows arrangement `C` here
 * instead, since the trip that paused it also claims that date's one
 * allocation row, DM §6.3). Both get their own glyph, `B`, rather than
 * being forced into "ran" (which would be a fact about the day that isn't
 * true yet) or "lost" (which is worse). Recorded here rather than guessed
 * silently, per CLAUDE.md's own "say so and make the case."
 */
function cellStyle(day: VehicleCalendarDay): CellStyle {
  if (day.arrangement === "A") return { wash: "bg-brand-wash text-brand-ink", glyph: "L" };
  if (day.arrangement === "C") {
    return day.isHold
      ? { wash: "border border-serious text-serious-ink", glyph: "T?" }
      : { wash: "bg-serious/15 text-serious-ink", glyph: "T" };
  }
  // arrangement B
  switch (day.dayRecordState) {
    case "ran_paid_full":
    case "ran_paid_short":
    case "ran_unpaid":
      return { wash: "bg-brand-wash text-brand-ink", glyph: "✓" };
    case "did_not_run":
      return { wash: "bg-serious/15 text-serious-ink", glyph: "!" };
    case "open":
    case "paused_for_trip":
    case null:
      return { wash: "bg-brand-wash text-brand-ink", glyph: "B" };
  }
}

function formatMonthLabel(date: BusinessDate): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(`${date}T00:00:00`),
  );
}

/**
 * F-1.5/UC-95, UI §7.6 — "the one screen that justifies a custom date
 * component." A month grid, one state per day, colour plus glyph so it
 * survives colour blindness and greyscale printing (never colour alone,
 * CLAUDE.md → Interface); the legend is a fixed row below, never a tooltip,
 * since the cell itself is already at the 44px tap-target floor.
 * **"Off the road" is not rendered** — no write path in this schema ever
 * marks a vehicle-day unavailable outside an actual lease/trip allocation,
 * so that state cannot occur yet; recorded rather than faked.
 */
export function VehicleCalendarScreen({ vehicleId, onBack, today }: VehicleCalendarScreenProps) {
  const api = useApi();
  const [monthAnchor, setMonthAnchor] = useState(today);

  const from = monthStart(monthAnchor);
  const to = monthEnd(monthAnchor);

  const { data: vehicle } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.get<VehicleResponse>(`/api/vehicle/${vehicleId}`),
  });
  const { data: days } = useQuery({
    queryKey: ["vehicle", vehicleId, "calendar", from, to],
    queryFn: () =>
      api.get<VehicleCalendarDay[]>(`/api/vehicle/${vehicleId}/calendar?from=${from}&to=${to}`),
  });

  const byDate = new Map((days ?? []).map((day) => [day.businessDate, day]));
  const leadingBlanks = weekdayOf(from);
  const totalDaysInMonth =
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 +
    1;
  const cells: { date: BusinessDate | null }[] = [
    ...Array.from({ length: leadingBlanks }, () => ({ date: null })),
    ...Array.from({ length: totalDaysInMonth }, (_, i) => ({ date: addDays(from, i) })),
  ];

  return (
    <Screen title={vehicle?.registration ?? "Calendar"} onBack={onBack}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonthAnchor(addCalendarMonths(monthAnchor, -1))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <p className="text-title text-ink-primary">{formatMonthLabel(monthAnchor)}</p>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonthAnchor(addCalendarMonths(monthAnchor, 1))}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label, index) => (
            <p key={index} className="text-center text-caption text-ink-muted">
              {label}
            </p>
          ))}
          {cells.map((cell, index) => {
            if (cell.date === null) {
              return <div key={index} />;
            }
            const day = byDate.get(cell.date);
            const style = day !== undefined ? cellStyle(day) : null;
            // eslint-disable-next-line no-restricted-syntax -- a day-of-month for display, not money
            const dayOfMonth = Number(cell.date.slice(8, 10));
            return (
              <div
                key={cell.date}
                data-testid={`day-${cell.date}`}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-sm text-body-sm",
                  style?.wash,
                )}
              >
                <span className="flex flex-col items-center leading-none">
                  <span>{dayOfMonth}</span>
                  {style !== null ? <span aria-hidden>{style.glyph}</span> : null}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-line-hairline pt-3">
          <LegendRow wash="bg-brand-wash text-brand-ink" glyph="L" label="On a lease" />
          <LegendRow wash="bg-brand-wash text-brand-ink" glyph="✓" label="Daily lease, ran" />
          <LegendRow
            wash="bg-brand-wash text-brand-ink"
            glyph="B"
            label="Daily lease, not yet confirmed"
          />
          <LegendRow wash="bg-serious/15 text-serious-ink" glyph="!" label="Daily lease, lost" />
          <LegendRow wash="bg-serious/15 text-serious-ink" glyph="T" label="On a trip" />
          <LegendRow
            wash="border border-serious text-serious-ink"
            glyph="T?"
            label="Hold (tentative)"
          />
        </div>
      </div>
    </Screen>
  );
}

function LegendRow({ wash, glyph, label }: { wash: string; glyph: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("flex size-6 items-center justify-center rounded-sm text-caption", wash)}>
        {glyph}
      </span>
      <span className="text-body-sm text-ink-secondary">{label}</span>
    </div>
  );
}
