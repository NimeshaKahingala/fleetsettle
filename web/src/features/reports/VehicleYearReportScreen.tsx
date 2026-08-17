import { parse, type BusinessDate } from "@fleetsettle/shared";
import type { VehicleYearResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { HorizontalBarChart } from "./charts/HorizontalBarChart.js";
import { ReportDateRangeFields } from "./ReportDateRangeFields.js";
import { ReportScreen } from "./ReportScreen.js";
import { toChartData, toKpiTotals, VehicleRow } from "./VehicleMonthReportScreen.js";

export interface VehicleYearReportScreenProps {
  from: BusinessDate;
  to: BusinessDate;
  today: BusinessDate;
  onParamsChange: (params: { from: BusinessDate; to: BusinessDate }) => void;
  onBack: () => void;
}

/**
 * GAP-18/UC-73 / `GET /api/reports/vehicle-year` — "as UC-70, with overheads
 * (UC-66) stated beneath vehicle profit, never spread across it": the same
 * per-vehicle earned/costs/profit/owner-share breakdown
 * `VehicleMonthReportScreen` renders (its own `VehicleRow`/`toKpiTotals`/
 * `toChartData` reused here rather than re-copied — the row shape is
 * structurally identical between `vehicle-month` and `vehicle-year`), plus
 * the window's own overheads figure as a fourth, unmarked `StatTile`
 * beneath the per-vehicle KPI row — a fourth number placed after the three
 * vehicle ones, never folded into `profitMinor`. Never degrades (same basis
 * as UC-70). Owner/owner-manager only (`viewOwnerOnlyReports`) — UC-73's own
 * "Sees" line, narrower than UC-70's manager-inclusive audience, so there is
 * no manager-scoped branch here the way `VehicleMonthReportScreen` needs.
 */
export function VehicleYearReportScreen({
  from,
  to,
  today,
  onParamsChange,
  onBack,
}: VehicleYearReportScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["reports", "vehicle-year", from, to],
    queryFn: () => api.get<VehicleYearResponse>(`/api/reports/vehicle-year?from=${from}&to=${to}`),
  });
  const state = useQueryState(query);

  const paramsForm = (
    <ReportDateRangeFields from={from} to={to} today={today} onParamsChange={onParamsChange} />
  );

  if (state.kind === "error") {
    return (
      <ReportScreen
        title="How was the year"
        onBack={onBack}
        table={
          <div className="flex flex-col gap-4">
            {paramsForm}
            <QueryStateFailure error={state.error} retry={state.retry} of="how the year went" />
          </div>
        }
      />
    );
  }
  if (state.kind !== "ready") {
    return (
      <ReportScreen
        title="How was the year"
        onBack={onBack}
        table={
          <div className="flex flex-col gap-4">
            {paramsForm}
            <p className="text-body text-ink-muted">Loading…</p>
          </div>
        }
      />
    );
  }

  const report = state.data;
  const totals = toKpiTotals(report.vehicles);

  return (
    <ReportScreen
      title="How was the year"
      subtitle={`${from} – ${to}`}
      onBack={onBack}
      chart={
        <div className="flex flex-col gap-3">
          {paramsForm}
          <div className="grid grid-cols-3 gap-2">
            <StatTile
              label="Earned"
              value={<Money value={totals.earnedMinor} />}
              className="border-l-[3px] border-l-brand"
            />
            <StatTile
              label="Spent"
              value={<Money value={totals.costsMinor} />}
              className="border-l-[3px] border-l-direction-payable"
            />
            <StatTile label="Profit" value={<Money value={totals.profitMinor} />} />
          </div>
          <StatTile label="Overheads" value={<Money value={parse(report.overheadsMinor)} />} />
          <HorizontalBarChart data={toChartData(report.vehicles)} />
        </div>
      }
      table={
        <div className="flex flex-col gap-2">
          {paramsForm}
          <StatTile label="Overheads" value={<Money value={parse(report.overheadsMinor)} />} />
          {report.vehicles.map((v) => (
            <VehicleRow key={v.vehicleId} vehicle={v} />
          ))}
        </div>
      }
    />
  );
}
