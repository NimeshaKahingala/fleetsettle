import { parse, type BusinessDate } from "@fleetsettle/shared";
import type { VehicleYearResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Card } from "../../design/primitives/Card.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { HorizontalBarChart } from "./charts/HorizontalBarChart.js";
import { ReportScreen } from "./ReportScreen.js";
import { ReportTable, type ReportTableColumn } from "./ReportTable.js";
import { toChartData, toKpiTotals } from "./VehicleMonthReportScreen.js";

export interface VehicleYearReportScreenProps {
  from: BusinessDate;
  to: BusinessDate;
  today: BusinessDate;
  onParamsChange: (params: { from: BusinessDate; to: BusinessDate }) => void;
  onBack: () => void;
}

const SHARE_COLUMNS: ReportTableColumn<
  VehicleYearResponse["vehicles"][number]["ownerShares"][number]
>[] = [
  { key: "name", header: "Owner", render: (row) => row.displayName ?? "Unnamed owner" },
  {
    key: "share",
    header: "Share",
    align: "end",
    render: (row) => `${(row.shareBp / 100).toString()}%`,
  },
  {
    key: "profitShare",
    header: "Profit share",
    align: "end",
    render: (row) => <Money value={parse(row.profitShareMinor)} />,
  },
];

function VehicleRow({ vehicle }: { vehicle: VehicleYearResponse["vehicles"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-tap w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-body font-medium text-ink-primary">{vehicle.registration}</span>
        <span className="flex items-center gap-2">
          <Money value={parse(vehicle.profitMinor)} />
          {open ? (
            <ChevronUp className="size-4 text-ink-muted" aria-hidden />
          ) : (
            <ChevronDown className="size-4 text-ink-muted" aria-hidden />
          )}
        </span>
      </button>
      {open ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-line-hairline pt-3">
          {/* §7.11/TwoBalances: same direction markers VehicleMonthReportScreen's own row uses. */}
          <div className="flex justify-between border-l-[3px] border-brand pl-2 text-body-sm text-ink-secondary">
            <span>Earned</span>
            <Money value={parse(vehicle.earnedMinor)} />
          </div>
          <div className="flex justify-between border-l-[3px] border-direction-payable pl-2 text-body-sm text-ink-secondary">
            <span>Spent</span>
            <Money value={parse(vehicle.costsMinor)} />
          </div>
          {vehicle.ownerShares.length > 0 ? (
            <ReportTable
              columns={SHARE_COLUMNS}
              rows={vehicle.ownerShares}
              rowKey={(row) => row.userId}
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * GAP-18/UC-73 / `GET /api/reports/vehicle-year` — "as UC-70, with overheads
 * (UC-66) stated beneath vehicle profit, never spread across it": the same
 * per-vehicle earned/costs/profit/owner-share breakdown
 * `VehicleMonthReportScreen` renders, plus the window's own overheads figure
 * as a fourth, unmarked `StatTile` beneath the per-vehicle KPI row — a
 * fourth number placed after the three vehicle ones, never folded into
 * `profitMinor`. Never degrades (same basis as UC-70). Owner/owner-manager
 * only (`viewOwnerOnlyReports`) — UC-73's own "Sees" line, narrower than
 * UC-70's manager-inclusive audience, so there is no manager-scoped branch
 * here the way `VehicleMonthReportScreen` needs.
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
