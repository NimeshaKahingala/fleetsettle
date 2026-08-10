import { format, parse } from "@fleetsettle/shared";
import type { RankedTripsResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { useApi } from "../../lib/ApiContext.js";
import { toAxisValue } from "../../lib/chartAxis.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { HorizontalBarChart, type HorizontalBarDatum } from "./charts/HorizontalBarChart.js";
import { ReportScreen } from "./ReportScreen.js";
import { ReportTable, type ReportTableColumn } from "./ReportTable.js";

export interface TripRankingReportScreenProps {
  onBack: () => void;
}

/** UC-71: ranked by profit, direct-labelled with the vehicle's registration — never a re-derivation of the server's own order. */
export function toChartData(rows: RankedTripsResponse): HorizontalBarDatum[] {
  return rows.map((row) => {
    const profit = parse(row.profitMinor);
    return {
      id: row.id,
      label: row.registration,
      value: toAxisValue(profit),
      formattedValue: `Rs ${format(profit)}`,
    };
  });
}

const COLUMNS: ReportTableColumn<RankedTripsResponse[number]>[] = [
  { key: "registration", header: "Vehicle", render: (row) => row.registration },
  {
    key: "agreed",
    header: "Agreed",
    align: "end",
    render: (row) => <Money value={parse(row.agreedAmountMinor)} />,
  },
  {
    key: "costs",
    header: "Costs",
    align: "end",
    render: (row) => <Money value={parse(row.costsMinor)} />,
  },
  {
    key: "driverFee",
    header: "Driver fee",
    align: "end",
    render: (row) => <Money value={parse(row.driverFeeMinor)} />,
  },
  {
    key: "profit",
    header: "Profit",
    align: "end",
    render: (row) => <Money value={parse(row.profitMinor)} />,
  },
  {
    key: "profitPerKm",
    header: "Profit / km",
    align: "end",
    render: (row) =>
      row.profitPerKm === null ? (
        <NotAvailable reason="no closing odometer" />
      ) : (
        // eslint-disable-next-line no-restricted-syntax -- a ranking ratio (profit per km), not money
        row.profitPerKm.toFixed(2)
      ),
  },
];

/**
 * UC-71 / `GET /api/reports/trips` — a trip with no closing odometer still
 * ranks by profit (the chart never excludes it), but its `profitPerKm`
 * shows `NotAvailable` rather than a misleading ratio — the same
 * degradation `kmPerLitre` already gets server-side, carried through to
 * the table column that shows it (the chart itself only ever plots
 * `profitMinor`, so there is nothing there for a missing distance to
 * corrupt).
 */
export function TripRankingReportScreen({ onBack }: TripRankingReportScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["reports", "trips"],
    queryFn: () => api.get<RankedTripsResponse>("/api/reports/trips"),
  });

  const state = useQueryState(query);

  if (state.kind === "error") {
    return (
      <ReportScreen
        title="Which trips made money"
        onBack={onBack}
        table={
          <QueryStateFailure error={state.error} retry={state.retry} of="which trips made money" />
        }
      />
    );
  }

  if (state.kind !== "ready") {
    return (
      <ReportScreen
        title="Which trips made money"
        onBack={onBack}
        table={<p className="text-body text-ink-muted">Loading…</p>}
      />
    );
  }

  if (state.data.length === 0) {
    return (
      <ReportScreen
        title="Which trips made money"
        onBack={onBack}
        table={<p className="text-body text-ink-secondary">No closed trips yet.</p>}
      />
    );
  }

  return (
    <ReportScreen
      title="Which trips made money"
      onBack={onBack}
      chart={<HorizontalBarChart data={toChartData(state.data)} />}
      table={<ReportTable columns={COLUMNS} rows={state.data} rowKey={(row) => row.id} />}
    />
  );
}
