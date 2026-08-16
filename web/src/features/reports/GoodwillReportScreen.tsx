import { parse, type BusinessDate } from "@fleetsettle/shared";
import type { AdjustmentType, GoodwillResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { ReportScreen } from "./ReportScreen.js";
import { ReportTable, type ReportTableColumn } from "./ReportTable.js";

export interface GoodwillReportScreenProps {
  from: BusinessDate;
  to: BusinessDate;
  today: BusinessDate;
  onParamsChange: (params: { from: BusinessDate; to: BusinessDate }) => void;
  onBack: () => void;
}

const ADJUSTMENT_TYPE_LABEL: Record<AdjustmentType, string> = {
  goodwill: "Goodwill",
  rounding: "Rounding",
  agreed_discount: "Agreed discount",
  late_fee: "Late fee",
  extra_charge: "Extra charge",
  waiver: "Waiver",
  auto_waiver: "Auto-waived",
};

const COLUMNS: ReportTableColumn<GoodwillResponse["byType"][number]>[] = [
  { key: "type", header: "Type", render: (row) => ADJUSTMENT_TYPE_LABEL[row.adjustmentType] },
  {
    key: "total",
    header: "Total",
    align: "end",
    render: (row) => <Money value={parse(row.totalMinor)} />,
  },
];

/**
 * UC-77 / `GET /api/reports/goodwill` — "small waivers are invisible
 * individually and material in aggregate" (§6.11), so the total leads as a
 * hero `StatTile` and the by-type breakdown (GAP-73) is the table beneath
 * it. **Never pooled with write-offs** (INV-14) — this report has no write-
 * off figure anywhere on it to pool with. Owner/owner-manager only
 * (`viewOwnerOnlyReports`), matching the route's own gate.
 */
export function GoodwillReportScreen({
  from,
  to,
  today,
  onParamsChange,
  onBack,
}: GoodwillReportScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["reports", "goodwill", from, to],
    queryFn: () => api.get<GoodwillResponse>(`/api/reports/goodwill?from=${from}&to=${to}`),
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

  return (
    <ReportScreen
      title="Goodwill given"
      subtitle={`${from} – ${to}`}
      onBack={onBack}
      table={
        <div className="flex flex-col gap-4">
          {paramsForm}
          {state.kind === "error" ? (
            <QueryStateFailure error={state.error} retry={state.retry} of="goodwill given" />
          ) : state.kind !== "ready" ? (
            <p className="text-body text-ink-muted">Loading…</p>
          ) : (
            <>
              <StatTile
                label="Total given"
                size="hero"
                value={<Money value={parse(state.data.totalMinor)} />}
              />
              {state.data.byType.length === 0 ? (
                <p className="text-body text-ink-secondary">Nothing waived in this window.</p>
              ) : (
                <ReportTable
                  columns={COLUMNS}
                  rows={state.data.byType}
                  rowKey={(row) => row.adjustmentType}
                />
              )}
            </>
          )}
        </div>
      }
    />
  );
}
