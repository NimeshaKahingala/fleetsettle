import { parse, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { LostDaysResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { useApi } from "../../lib/ApiContext.js";
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

/**
 * `LostDaysRow` arrives one row per driver **per weekday** — this report's
 * own doc comment names driver and weekday as the two real dimensions, and
 * UI §11.1's "column per month" does not match what the endpoint can
 * produce (no month field exists on the row at all, only `weekday`).
 * Summing across weekdays to one total per driver is the honest reading of
 * what this contract can prove today; a real per-month time series and the
 * weekday-breakdown chart both wait on the same query change GAP-71 already
 * schedules — recorded there rather than guessed at here.
 */
export function toDriverTotals(rows: LostDaysResponse): DriverLostDaysTotal[] {
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

/** `lost` is a plain day count (already `number` on the wire), not money — no axis codec needed, the same reason `distanceKm`/`weekday` elsewhere never touch it either. */
export function toChartData(totals: DriverLostDaysTotal[]): ColumnDatum[] {
  return totals.map((t) => ({
    id: t.driverId,
    label: t.driverName ?? "Unnamed driver",
    value: t.lost,
    formattedValue: t.lost.toString(),
  }));
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
    render: (row) => <Money value={row.lostValueMinor} />,
  },
];

/**
 * UC-76 / `GET /api/reports/lost-days` — UC-06's "your only protection".
 * The denominator shown is `leaseEligible` (`ran + lost`), read directly off
 * the endpoint's own field rather than recomputed client-side — the same
 * exclusion logic §1.2 already applies server-side (off-pattern and
 * charter-paused days never enter it). `lostValueMinor` stays per-driver,
 * never summed into one business-wide figure (a lost day's value is
 * driver-specific). Empty means no daily-lease days at all in the window,
 * not "no days lost" — a real, if unlikely, zero would still show a chart.
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

  if (query.data === undefined) {
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

  const totals = toDriverTotals(query.data);

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
        <div className="flex flex-col gap-3">
          {paramsForm}
          <ColumnChart data={toChartData(totals)} />
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
