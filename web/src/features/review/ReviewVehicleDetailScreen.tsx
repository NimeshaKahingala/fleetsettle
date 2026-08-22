import { parse } from "@fleetsettle/shared";
import type { AccountingPeriodListRow, VehicleMonthResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { ReportTable, type ReportTableColumn } from "../reports/ReportTable.js";

export interface ReviewVehicleDetailScreenProps {
  vehicleId: string;
  periodId: string;
  onBack: () => void;
}

const SHARE_COLUMNS: ReportTableColumn<
  VehicleMonthResponse["vehicles"][number]["ownerShares"][number]
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

/**
 * B4-REPORTS-DESIGN.md §5.5: "one vehicle × all periods" — the `Vehicles`
 * tab's own detail, distinct from `This month` which is one period × every
 * vehicle. **Read-only by construction** (§7.8's own rule): reuses
 * `GET /api/reports/vehicle-month`'s `vehicleId` filter rather than
 * `VehicleOverviewScreen`, which is built the other way round — actions
 * menu, cost entry, document upsert. Costs one fetch per period viewed, via
 * its own picker, rather than N up front.
 */
export function ReviewVehicleDetailScreen({
  vehicleId,
  periodId,
  onBack,
}: ReviewVehicleDetailScreenProps) {
  const api = useApi();
  const [currentPeriodId, setCurrentPeriodId] = useState(periodId);
  const [pickerOpen, setPickerOpen] = useState(false);

  const periodsQuery = useQuery({
    queryKey: ["accounting-period"],
    queryFn: () => api.get<AccountingPeriodListRow[]>("/api/accounting-period"),
  });

  const reportQuery = useQuery({
    queryKey: ["reports", "vehicle-month", currentPeriodId, vehicleId],
    queryFn: () =>
      api.get<VehicleMonthResponse>(
        `/api/reports/vehicle-month?periodId=${currentPeriodId}&vehicleId=${vehicleId}`,
      ),
  });

  // GAP-101: the old guard was `vehicle === undefined ? (isPending ? "Loading…"
  // : "No figures…") : …` — a failed read has `isPending === false` too, so
  // it fell into "No figures for this vehicle in this period.", a false
  // claim about a read that never came back.
  const reportState = useQueryState(reportQuery);
  const periodsState = useQueryState(periodsQuery);
  const vehicle = reportState.kind === "ready" ? reportState.data.vehicles[0] : undefined;

  return (
    <Screen title={vehicle?.registration ?? "Vehicle"} onBack={onBack}>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="min-h-tap self-start rounded-sm border border-transparent bg-surface-sunken px-3 text-body text-ink-primary"
        >
          {reportState.kind === "ready" ? reportState.data.period.periodStart : "…"} –{" "}
          {reportState.kind === "ready" ? reportState.data.period.periodEnd : "…"} ▾
        </button>

        {reportState.kind === "error" ? (
          <QueryStateFailure
            error={reportState.error}
            retry={reportState.retry}
            of="this vehicle's figures"
          />
        ) : vehicle === undefined ? (
          <p className="text-body text-ink-muted">
            {reportState.kind !== "ready"
              ? "Loading…"
              : "No figures for this vehicle in this period."}
          </p>
        ) : (
          <>
            {/* §7.11/TwoBalances: earned (income, brand) and spent (a cost,
                direction-payable) each get the same 3px leading-border
                marker VehiclePerformanceCard uses; profit is a derived net,
                left unmarked the same way TwoBalances' own net line is. */}
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                label="Earned"
                value={<Money value={parse(vehicle.earnedMinor)} />}
                className="border-l-[3px] border-l-brand"
              />
              <StatTile
                label="Spent"
                value={<Money value={parse(vehicle.costsMinor)} />}
                className="border-l-[3px] border-l-direction-payable"
              />
              <StatTile label="Profit" value={<Money value={parse(vehicle.profitMinor)} />} />
            </div>
            {vehicle.ownerShares.length > 0 ? (
              <ReportTable
                columns={SHARE_COLUMNS}
                rows={vehicle.ownerShares}
                rowKey={(row) => row.userId}
              />
            ) : null}
          </>
        )}
      </div>

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen} title="Choose a month">
        <div className="flex flex-col gap-1 pb-2">
          {periodsState.kind === "error" ? (
            <QueryStateFailure
              error={periodsState.error}
              retry={periodsState.retry}
              of="the accounting periods"
            />
          ) : null}
          {(periodsQuery.data ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setCurrentPeriodId(p.id);
                setPickerOpen(false);
              }}
              className={cn(
                "min-h-tap rounded-sm px-3 text-left text-body",
                rowButtonFocus,
                p.id === currentPeriodId
                  ? "bg-brand-wash text-brand-ink"
                  : "text-ink-primary active:bg-brand-wash",
              )}
            >
              {p.periodStart} – {p.periodEnd}
              {p.status === "open" ? " (open)" : ""}
            </button>
          ))}
        </div>
      </Sheet>
    </Screen>
  );
}
