import { parse } from "@fleetsettle/shared";
import type { AccountingPeriodListRow, VehicleMonthResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { Money } from "../../components/Money.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
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

  const vehicle = reportQuery.data?.vehicles[0];

  return (
    <Screen title={vehicle?.registration ?? "Vehicle"} onBack={onBack}>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="min-h-tap self-start rounded-sm border border-line-strong px-3 text-body text-ink-primary"
        >
          {reportQuery.data?.period.periodStart ?? "…"} –{" "}
          {reportQuery.data?.period.periodEnd ?? "…"} ▾
        </button>

        {vehicle === undefined ? (
          <p className="text-body text-ink-muted">
            {reportQuery.isPending ? "Loading…" : "No figures for this vehicle in this period."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Card className="flex flex-col gap-1">
                <span className="text-caption text-ink-muted">Earned</span>
                <Money value={parse(vehicle.earnedMinor)} className="text-body font-medium" />
              </Card>
              <Card className="flex flex-col gap-1">
                <span className="text-caption text-ink-muted">Spent</span>
                <Money value={parse(vehicle.costsMinor)} className="text-body font-medium" />
              </Card>
              <Card className="flex flex-col gap-1">
                <span className="text-caption text-ink-muted">Profit</span>
                <Money value={parse(vehicle.profitMinor)} className="text-body font-medium" />
              </Card>
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
