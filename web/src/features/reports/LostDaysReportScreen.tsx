import { parse, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { LostDaysResponse, LostReason } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { DateField } from "../../components/DateField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { useApi } from "../../lib/ApiContext.js";
import { LOST_REASON_OPTIONS } from "../../lib/lostReasonLabel.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { ColumnChart, type ColumnDatum } from "./charts/ColumnChart.js";
import { ReportScreen } from "./ReportScreen.js";
import { ReportTable, type ReportTableColumn } from "./ReportTable.js";

export interface LostDaysReportScreenProps {
  from: BusinessDate;
  to: BusinessDate;
  today: BusinessDate;
  onParamsChange: (params: { from: BusinessDate; to: BusinessDate }) => void;
  onBack: () => void;
}

export interface DriverLostDaysTotal {
  driverId: string;
  driverName: string | null;
  lost: number;
  ran: number;
  leaseEligible: number;
  lostValueMinor: Minor;
}

/** `to_char(business_date, 'YYYY-MM')` on the wire — indexed 0 for January, matching `Date`'s own convention closely enough to reuse without a library. */
const MONTH_LABEL = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthLabel(month: string): string {
  const [year, monthNum] = month.split("-");
  // eslint-disable-next-line no-restricted-syntax -- a 1-12 month-number label index, not money
  const index = Number(monthNum) - 1;
  const name = MONTH_LABEL[index] ?? month;
  return `${name} ${year ?? ""}`.trim();
}

/** `EXTRACT(dow FROM …)` on the wire — 0 is Sunday, matching Postgres's own convention (DM §15), not `Date.getDay()`'s (which happens to agree, but this array is keyed to the wire contract, not the coincidence). */
const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Per-driver totals across the whole window — unchanged since Wave 1, now sourced from `byWeekday` rather than a flat array. */
export function toDriverTotals(rows: LostDaysResponse["byWeekday"]): DriverLostDaysTotal[] {
  const byDriver = new Map<string, DriverLostDaysTotal>();
  for (const row of rows) {
    const existing = byDriver.get(row.driverId);
    const lostValue = parse(row.lostValueMinor);
    if (existing === undefined) {
      byDriver.set(row.driverId, {
        driverId: row.driverId,
        driverName: row.driverName,
        lost: row.lost,
        ran: row.ran,
        leaseEligible: row.leaseEligible,
        lostValueMinor: lostValue,
      });
    } else {
      existing.lost += row.lost;
      existing.ran += row.ran;
      existing.leaseEligible += row.leaseEligible;
      existing.lostValueMinor = ((existing.lostValueMinor as bigint) +
        (lostValue as bigint)) as Minor;
    }
  }
  return [...byDriver.values()];
}

/**
 * GAP-71/UI §11.1: "Column per month" — the report's primary form, summed
 * across every driver so the business-wide pattern is the first thing
 * shown; per-driver detail stays in the table below. Sorted chronologically
 * rather than by count, since a time series read out of order is not a
 * time series.
 */
export function toMonthChartData(rows: LostDaysResponse["byMonth"]): ColumnDatum[] {
  const byMonth = new Map<string, number>();
  for (const row of rows) {
    byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.lost);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, lost]) => ({
      id: month,
      label: monthLabel(month),
      value: lost,
      formattedValue: lost.toString(),
    }));
}

/** GAP-71/UI §11.1: the weekday-distribution second-tier chart — "a driver who takes Fridays off" — summed across drivers. All seven weekdays always render, Sunday first, matching `EXTRACT(dow …)`'s own convention: a weekday with nothing lost is a real zero (W-56), not an absent bar. */
export function toWeekdayChartData(rows: LostDaysResponse["byWeekday"]): ColumnDatum[] {
  const byWeekday = new Map<number, number>();
  for (const row of rows) {
    byWeekday.set(row.weekday, (byWeekday.get(row.weekday) ?? 0) + row.lost);
  }
  return WEEKDAY_LABEL.map((label, weekday) => {
    const lost = byWeekday.get(weekday) ?? 0;
    return { id: weekday.toString(), label, value: lost, formattedValue: lost.toString() };
  });
}

/** GAP-71/UI §11.1: the reason-breakdown second-tier chart — "a bus that breaks down often" — summed across drivers, in the same fixed order `ReasonPicker` presents them (F-4.4). Only reasons actually present in the window render — unlike weekday, there is no fixed "all six always shown" expectation in UC-76's own text. */
export function toReasonChartData(rows: LostDaysResponse["byReason"]): ColumnDatum[] {
  const byReason = new Map<LostReason, number>();
  for (const row of rows) {
    byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + row.lost);
  }
  return LOST_REASON_OPTIONS.filter((o) => byReason.has(o.key)).map((o) => {
    const lost = byReason.get(o.key) as number;
    return { id: o.key, label: o.label, value: lost, formattedValue: lost.toString() };
  });
}

const COLUMNS: ReportTableColumn<DriverLostDaysTotal>[] = [
  { key: "driver", header: "Driver", render: (row) => row.driverName ?? "Unnamed driver" },
  {
    key: "lost",
    header: "Lost / eligible",
    align: "end",
    render: (row) => `${row.lost.toString()} / ${row.leaseEligible.toString()}`,
  },
  {
    key: "value",
    header: "Value",
    align: "end",
    money: (row) => row.lostValueMinor,
  },
];

/**
 * UC-76 / `GET /api/reports/lost-days` — UC-06's "your only protection".
 * The denominator shown in the table is `leaseEligible` (`ran + lost`), read
 * directly off the endpoint's own field rather than recomputed client-side —
 * the same exclusion logic §1.2 already applies server-side (off-pattern and
 * charter-paused days never enter it). `lostValueMinor` stays per-driver in
 * the table, never summed into one business-wide figure.
 *
 * GAP-71/Wave 2: the primary chart is now genuinely "column per month"
 * (UI §11.1), with weekday distribution and the reason breakdown as its two
 * second-tier charts — the shape UI §11.1 and DM §15 both specify. Empty
 * means no daily-lease days at all in the window, not "no days lost" — a
 * real, if unlikely, zero would still show a chart.
 */
export function LostDaysReportScreen({
  from,
  to,
  today,
  onParamsChange,
  onBack,
}: LostDaysReportScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["reports", "lost-days", from, to],
    queryFn: () => api.get<LostDaysResponse>(`/api/reports/lost-days?from=${from}&to=${to}`),
  });

  const paramsForm = (
    <div className="flex gap-3">
      <DateField
        label="From"
        value={from}
        today={today}
        onChange={(date) => onParamsChange({ from: date, to })}
      />
      <DateField
        label="To"
        value={to}
        today={today}
        onChange={(date) => onParamsChange({ from, to: date })}
      />
    </div>
  );

  const state = useQueryState(query);

  if (state.kind === "error") {
    return (
      <ReportScreen
        title="Lost days"
        onBack={onBack}
        table={
          <div className="flex flex-col gap-3">
            {paramsForm}
            <QueryStateFailure error={state.error} retry={state.retry} of="lost days" />
          </div>
        }
      />
    );
  }

  if (state.kind !== "ready") {
    return (
      <ReportScreen
        title="Lost days"
        onBack={onBack}
        table={
          <div className="flex flex-col gap-3">
            {paramsForm}
            <p className="text-body text-ink-muted">Loading…</p>
          </div>
        }
      />
    );
  }

  const totals = toDriverTotals(state.data.byWeekday);

  if (totals.length === 0) {
    return (
      <ReportScreen
        title="Lost days"
        subtitle={`${from} – ${to}`}
        onBack={onBack}
        table={
          <div className="flex flex-col gap-3">
            {paramsForm}
            <p className="text-body text-ink-secondary">No daily-lease days in this window.</p>
          </div>
        }
      />
    );
  }

  return (
    <ReportScreen
      title="Lost days"
      subtitle={`${from} – ${to}`}
      onBack={onBack}
      chart={
        <div className="flex flex-col gap-4">
          {paramsForm}
          <ColumnChart data={toMonthChartData(state.data.byMonth)} />
          <div className="flex flex-col gap-1">
            <p className="text-caption text-ink-muted">By weekday</p>
            <ColumnChart
              data={toWeekdayChartData(state.data.byWeekday)}
              height={120}
              color="var(--color-chart-3)"
            />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-caption text-ink-muted">By reason</p>
            <ColumnChart
              data={toReasonChartData(state.data.byReason)}
              height={120}
              color="var(--color-chart-4)"
            />
          </div>
        </div>
      }
      table={
        <div className="flex flex-col gap-3">
          {paramsForm}
          <ReportTable columns={COLUMNS} rows={totals} rowKey={(row) => row.driverId} />
        </div>
      }
    />
  );
}
