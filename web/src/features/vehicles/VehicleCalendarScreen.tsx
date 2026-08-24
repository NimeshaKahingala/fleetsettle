import {
  addCalendarMonths,
  addDays,
  monthEnd,
  monthStart,
  weekdayOf,
  type BusinessDate,
} from "@fleetsettle/shared";
import type {
  SessionResponse,
  VehicleCalendarDay,
  VehicleResponse,
  VehicleUnavailabilityListResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { can } from "../../lib/capabilities.js";
import { cn } from "../../lib/cn.js";
import { resolveSelectedMembership } from "../../lib/selectedMembership.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { VEHICLE_UNAVAILABILITY_REASON_LABEL } from "../../lib/vehicleUnavailabilityReasonLabel.js";
import { MarkVehicleUnavailableSheet } from "./MarkVehicleUnavailableSheet.js";
import { VoidVehicleUnavailabilitySheet } from "./VoidVehicleUnavailabilitySheet.js";

export interface VehicleCalendarScreenProps {
  vehicleId: string;
  onBack: () => void;
  /** Injected — never read from the device clock here (CLAUDE.md → Time); `createAppRouteTree`'s own `today` is threaded down through the route, the same way `VehicleListScreen` (this feature's sibling) already takes it. */
  today: BusinessDate;
  /**
   * F-1.5's own Accept: "tapping a free day opens F-5.1 or F-2.1 with that
   * date filled in." An arrangement-A vehicle's free day opens F-2.1
   * (Web-P6c); a B or C vehicle's opens F-5.1 instead (Web-P7) — a trip is
   * real regardless of what a vehicle is normally arranged as (the bus's
   * own daily lease doesn't stop it taking a one-off charter), so this is
   * the two arrangements' free day, not "day nothing owns yet."
   */
  onSelectFreeDay?: (date: BusinessDate) => void;
  /** Web-P7's own half of the same Accept clause, for a B/C vehicle's free day. */
  onSelectFreeDayForTrip?: (date: BusinessDate) => void;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

interface CellStyle {
  wash: string;
  glyph: string;
  /** GAP-46: the same wording `LegendRow` renders below, so the occupied
   * cell announces its state to a screen reader the way colour plus glyph
   * already does for a sighted user (CLAUDE.md → colour never carries
   * meaning alone). */
  label: string;
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
const OFF_ROAD_STYLE: CellStyle = {
  wash: "bg-ink-faint/40 text-ink-muted",
  glyph: "R",
  label: "Off the road",
};

/**
 * F-1.10/GAP-26: a live outage is layered on top of whatever occupancy a
 * date already has — a daily-lease vehicle sits off the road *alongside*
 * an existing driver assignment (F-1.10's own text), not instead of one —
 * so this checks membership directly against the fetched ranges rather
 * than folding into `cellStyle`'s per-arrangement switch, and the caller
 * checks it first.
 */
function isOffRoad(date: BusinessDate, ranges: VehicleUnavailabilityListResponse): boolean {
  return ranges.some(
    (r) => date >= r.unavailableFrom && (r.unavailableTo === null || date <= r.unavailableTo),
  );
}

function cellStyle(day: VehicleCalendarDay): CellStyle {
  if (day.arrangement === "A") {
    return { wash: "bg-brand-wash text-brand-ink", glyph: "L", label: "On a lease" };
  }
  if (day.arrangement === "C") {
    return day.isHold
      ? { wash: "border border-trip text-trip-ink", glyph: "T?", label: "Hold (tentative)" }
      : { wash: "bg-trip/15 text-trip-ink", glyph: "T", label: "On a trip" };
  }
  // arrangement B — each of the four reachable states gets its own token
  // (UI-LF-07): "ran" and "not yet confirmed" used to share the brand
  // wash, told apart only by glyph.
  switch (day.dayRecordState) {
    case "ran_paid_full":
    case "ran_paid_short":
    case "ran_unpaid":
      return { wash: "bg-good/15 text-good-ink", glyph: "✓", label: "Daily lease, ran" };
    case "did_not_run":
      return { wash: "bg-critical/15 text-critical-ink", glyph: "!", label: "Daily lease, lost" };
    case "open":
    case "paused_for_trip":
    case null:
      return {
        wash: "bg-warning/15 text-warning-ink",
        glyph: "B",
        label: "Daily lease, not yet confirmed",
      };
  }
}

function formatMonthLabel(date: BusinessDate): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * F-1.5/UC-95, UI §7.6 — "the one screen that justifies a custom date
 * component." A month grid, one state per day, colour plus glyph so it
 * survives colour blindness and greyscale printing (never colour alone,
 * CLAUDE.md → Interface); the legend is a fixed row below, never a tooltip,
 * since the cell itself is already at the 44px tap-target floor.
 * **"Off the road" (GAP-26), closed 15 Aug 2026**: every live
 * `vehicle_unavailability` range overlapping the visible month, fetched
 * separately from occupancy (it is vehicle-level and arrangement-agnostic,
 * data-model.md §4.2) and checked first per cell — an outage can sit
 * alongside an existing daily-lease assignment, not only on an otherwise
 * free day.
 */
export function VehicleCalendarScreen({
  vehicleId,
  onBack,
  today,
  onSelectFreeDay,
  onSelectFreeDayForTrip,
}: VehicleCalendarScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [monthAnchor, setMonthAnchor] = useState(today);
  const [markUnavailableOpen, setMarkUnavailableOpen] = useState(false);
  const [voidUnavailabilityTarget, setVoidUnavailabilityTarget] = useState<string | null>(null);

  const session = queryClient.getQueryData<SessionResponse>(["session"]);
  const selectedRole = session !== undefined ? resolveSelectedMembership(session)?.role : undefined;
  // GAP-26/GAP-147: markVehicleUnavailableHandler/voidVehicleUnavailabilityHandler
  // are both dailyOperations, the same gate listVehicleUnavailabilityHandler
  // (this screen's own read) already uses.
  const canMarkUnavailable = selectedRole !== undefined && can(selectedRole, "dailyOperations");

  const from = monthStart(monthAnchor);
  const to = monthEnd(monthAnchor);

  // allow: title fallback plus fails-closed arrangement gating (never
  // offers a free-day action when unresolved, only withholds it) — the
  // occupancy grid itself is daysQuery/unavailabilityQuery, both wrapped.
  const { data: vehicle } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.get<VehicleResponse>(`/api/vehicle/${vehicleId}`),
  });
  const daysQuery = useQuery({
    queryKey: ["vehicle", vehicleId, "calendar", from, to],
    queryFn: () =>
      api.get<VehicleCalendarDay[]>(`/api/vehicle/${vehicleId}/calendar?from=${from}&to=${to}`),
  });
  const unavailabilityQuery = useQuery({
    queryKey: ["vehicle", vehicleId, "unavailability", from, to],
    queryFn: () =>
      api.get<VehicleUnavailabilityListResponse>(
        `/api/vehicle/${vehicleId}/unavailability?from=${from}&to=${to}`,
      ),
  });
  // GAP-101/INV-1: a failed calendar read must not render as every day
  // free — `?? []` used to do exactly that, on the one screen whose job is
  // stopping a double-booking. The same discipline now covers the outage
  // read too — a failed or still-pending fetch must not render as "nothing
  // is off the road" any more than it may render as "everything is free".
  const daysState = useQueryState(daysQuery);
  const unavailabilityState = useQueryState(unavailabilityQuery);
  const days = daysQuery.data;
  const unavailability = unavailabilityQuery.data ?? [];

  const byDate = new Map((days ?? []).map((day) => [day.businessDate, day]));
  const leadingBlanks = weekdayOf(from);
  const totalDaysInMonth =
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 +
    1;
  const cells: { date: BusinessDate | null }[] = [
    ...Array.from({ length: leadingBlanks }, () => ({ date: null })),
    ...Array.from({ length: totalDaysInMonth }, (_, i) => ({ date: addDays(from, i) })),
  ];

  // TS can't carry the outer `||` narrowing into a separate ternary below,
  // so this picks whichever of the two queries actually failed once, up
  // front, as a properly discriminated value.
  const failedState =
    daysState.kind === "error"
      ? daysState
      : unavailabilityState.kind === "error"
        ? unavailabilityState
        : null;

  return (
    <Screen
      title={vehicle?.registration ?? "Calendar"}
      onBack={onBack}
      {...(canMarkUnavailable
        ? {
            primaryAction: {
              label: "Mark unavailable",
              onClick: () => setMarkUnavailableOpen(true),
            },
          }
        : {})}
    >
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

        {failedState !== null ? (
          <QueryStateFailure
            error={failedState.error}
            retry={failedState.retry}
            of="this month's calendar"
          />
        ) : daysState.kind !== "ready" || unavailabilityState.kind !== "ready" ? (
          // GAP-127: `byDate` is built from `days ?? []` below — rendering
          // the grid while either fetch is still in flight would read every
          // date as free (or as never off the road) on the one screen whose
          // job is stopping a double-booking (INV-1), the same false-empty
          // shape the error branch above already guards against.
          <p className="text-body text-ink-muted">Loading…</p>
        ) : (
          <>
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
                const offRoad = isOffRoad(cell.date, unavailability);
                const style = offRoad ? OFF_ROAD_STYLE : day !== undefined ? cellStyle(day) : null;
                // eslint-disable-next-line no-restricted-syntax -- a day-of-month for display, not money
                const dayOfMonth = Number(cell.date.slice(8, 10));
                const cellDate = cell.date;
                // F-1.10: an off-road day is "distinct from a free day"
                // (its own Accept clause) — never offered as a free slot to
                // start a rental or book a trip against, even though no
                // allocation row claims it.
                const isFree = day === undefined && !offRoad;
                const canStartLease =
                  isFree && vehicle?.arrangement === "A" && onSelectFreeDay !== undefined;
                const canBookTrip =
                  isFree &&
                  (vehicle?.arrangement === "B" || vehicle?.arrangement === "C") &&
                  onSelectFreeDayForTrip !== undefined;
                const content = (
                  <span className="flex flex-col items-center leading-none">
                    <span>{dayOfMonth}</span>
                    {style !== null ? <span aria-hidden>{style.glyph}</span> : null}
                  </span>
                );
                return canStartLease || canBookTrip ? (
                  <button
                    key={cellDate}
                    type="button"
                    data-testid={`day-${cellDate}`}
                    onClick={() =>
                      canStartLease ? onSelectFreeDay(cellDate) : onSelectFreeDayForTrip?.(cellDate)
                    }
                    aria-label={
                      canStartLease
                        ? `Start a rental from ${cellDate}`
                        : `Book a trip from ${cellDate}`
                    }
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-sm text-body-sm",
                      style?.wash,
                    )}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={cellDate}
                    data-testid={`day-${cellDate}`}
                    {...(style !== null ? { "aria-label": `${cellDate} — ${style.label}` } : {})}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-sm text-body-sm",
                      style?.wash,
                    )}
                  >
                    {content}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-line-hairline pt-3">
              <LegendRow wash="bg-brand-wash text-brand-ink" glyph="L" label="On a lease" />
              <LegendRow wash="bg-good/15 text-good-ink" glyph="✓" label="Daily lease, ran" />
              <LegendRow
                wash="bg-warning/15 text-warning-ink"
                glyph="B"
                label="Daily lease, not yet confirmed"
              />
              <LegendRow
                wash="bg-critical/15 text-critical-ink"
                glyph="!"
                label="Daily lease, lost"
              />
              <LegendRow wash="bg-trip/15 text-trip-ink" glyph="T" label="On a trip" />
              <LegendRow
                wash="border border-trip text-trip-ink"
                glyph="T?"
                label="Hold (tentative)"
              />
              <LegendRow
                wash={OFF_ROAD_STYLE.wash}
                glyph={OFF_ROAD_STYLE.glyph}
                label="Off the road"
              />
            </div>

            {canMarkUnavailable && unavailability.length > 0 ? (
              <Section
                title="Unavailable periods"
                count={unavailability.length}
                items={unavailability.map((period) => (
                  <Card
                    key={period.id}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-body text-ink-primary">
                        {VEHICLE_UNAVAILABILITY_REASON_LABEL[period.reason] ?? period.reason}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {formatShortDate(period.unavailableFrom)} –{" "}
                        {period.unavailableTo !== null
                          ? formatShortDate(period.unavailableTo)
                          : "ongoing"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVoidUnavailabilityTarget(period.id)}
                      className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                    >
                      Void period
                    </button>
                  </Card>
                ))}
              />
            ) : null}
          </>
        )}
      </div>
      <MarkVehicleUnavailableSheet
        open={markUnavailableOpen}
        onOpenChange={setMarkUnavailableOpen}
        vehicleId={vehicleId}
        today={today}
      />
      <VoidVehicleUnavailabilitySheet
        open={voidUnavailabilityTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidUnavailabilityTarget(null);
        }}
        vehicleId={vehicleId}
        unavailabilityId={voidUnavailabilityTarget}
      />
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
