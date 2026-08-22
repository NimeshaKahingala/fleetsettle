import { format, parse, type Minor } from "@fleetsettle/shared";
import type { AccountingPeriodListRow, VehicleMonthResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Card } from "../../design/primitives/Card.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { useApi } from "../../lib/ApiContext.js";
import { toAxisValue } from "../../lib/chartAxis.js";
import { cn } from "../../lib/cn.js";
import { formatShortDate } from "../../lib/formatShortDate.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { HorizontalBarChart, type HorizontalBarDatum } from "./charts/HorizontalBarChart.js";
import { ReportScreen } from "./ReportScreen.js";
import { ReportTable, type ReportTableColumn } from "./ReportTable.js";

export interface VehicleMonthReportScreenProps {
  periodId?: string;
  onPeriodChange: (periodId: string) => void;
  onBack: () => void;
}

export interface KpiTotals {
  earnedMinor: Minor;
  costsMinor: Minor;
  profitMinor: Minor;
}

/** UC-70's KPI row: earned/spent/profit combined across every returned vehicle — bigint addition, never a `Number` intermediate. */
export function toKpiTotals(vehicles: VehicleMonthResponse["vehicles"]): KpiTotals {
  let earned = 0n;
  let costs = 0n;
  let profit = 0n;
  for (const v of vehicles) {
    earned += parse(v.earnedMinor);
    costs += parse(v.costsMinor);
    profit += parse(v.profitMinor);
  }
  return {
    earnedMinor: earned as Minor,
    costsMinor: costs as Minor,
    profitMinor: profit as Minor,
  };
}

export function toChartData(vehicles: VehicleMonthResponse["vehicles"]): HorizontalBarDatum[] {
  return vehicles.map((v) => {
    const profit = parse(v.profitMinor);
    return {
      id: v.vehicleId,
      label: v.registration,
      value: toAxisValue(profit),
      formattedValue: `Rs ${format(profit)}`,
    };
  });
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
    money: (row) => parse(row.profitShareMinor),
  },
];

/** Exported for `VehicleYearReportScreen` (GAP-18) — the row shape is structurally identical between `vehicle-month` and `vehicle-year`, so this renders both rather than being re-typed and re-copied. */
export function VehicleRow({ vehicle }: { vehicle: VehicleMonthResponse["vehicles"][number] }) {
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
      {parse(vehicle.profitMinor) === 0n ? (
        <p className="text-caption text-ink-muted">No activity this month yet</p>
      ) : null}
      {open ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-line-hairline pt-3">
          {/* §7.11/TwoBalances: earned (brand) vs spent (direction-payable), same 3px leading-border marker. */}
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
              bare
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function PeriodPickerSheet({
  periods,
  currentPeriodId,
  open,
  onOpenChange,
  onSelect,
}: {
  periods: AccountingPeriodListRow[];
  currentPeriodId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (periodId: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Choose a month">
      <div className="flex flex-col gap-1 pb-2">
        {periods.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onSelect(p.id);
              onOpenChange(false);
            }}
            className={cn(
              "min-h-tap rounded-sm px-3 text-left text-body",
              rowButtonFocus,
              p.id === currentPeriodId
                ? "bg-brand-wash text-brand-ink"
                : "text-ink-primary active:bg-brand-wash",
            )}
          >
            {formatShortDate(p.periodStart)} – {formatShortDate(p.periodEnd)}
            {p.status === "open" ? " (open)" : ""}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * UC-70 / `GET /api/reports/vehicle-month` — never degrades (UC-70's own
 * text: "always computable"), so there is no empty/NotAvailable branch here
 * the way the other five reports need. `periodId` defaults to the
 * currently-open period once the period list resolves — the same list
 * feeds this screen's own picker, so it is one fetch for both (B4-REPORTS-
 * DESIGN.md §5.2).
 */
export function VehicleMonthReportScreen({
  periodId,
  onPeriodChange,
  onBack,
}: VehicleMonthReportScreenProps) {
  const api = useApi();
  const [pickerOpen, setPickerOpen] = useState(false);

  const periodsQuery = useQuery({
    queryKey: ["accounting-period"],
    queryFn: () => api.get<AccountingPeriodListRow[]>("/api/accounting-period"),
  });

  const resolvedPeriodId =
    periodId ??
    periodsQuery.data?.find((p) => p.status === "open")?.id ??
    periodsQuery.data?.[0]?.id;

  const reportQuery = useQuery({
    queryKey: ["reports", "vehicle-month", resolvedPeriodId],
    queryFn: () => {
      // `enabled` below never lets this run while undefined — narrowed here
      // rather than asserted, so a future edit dropping `enabled` fails loud.
      if (resolvedPeriodId === undefined) throw new Error("no period resolved yet");
      return api.get<VehicleMonthResponse>(
        `/api/reports/vehicle-month?periodId=${resolvedPeriodId}`,
      );
    },
    enabled: resolvedPeriodId !== undefined,
  });
  const periodsState = useQueryState(periodsQuery);
  const reportState = useQueryState(reportQuery);

  // GAP-101: `periodsQuery` failing is the primary cause — without it
  // `resolvedPeriodId` never resolves, so `reportQuery` stays `idle`
  // forever, not `pending`. Checked first so the real cause is what's shown.
  if (periodsState.kind === "error") {
    return (
      <ReportScreen
        title="How was this month"
        onBack={onBack}
        table={
          <QueryStateFailure
            error={periodsState.error}
            retry={periodsState.retry}
            of="the accounting periods"
          />
        }
      />
    );
  }
  if (reportState.kind === "error") {
    return (
      <ReportScreen
        title="How was this month"
        onBack={onBack}
        table={
          <QueryStateFailure
            error={reportState.error}
            retry={reportState.retry}
            of="how this month went"
          />
        }
      />
    );
  }
  if (reportState.kind !== "ready" || periodsState.kind !== "ready") {
    return (
      <ReportScreen
        title="How was this month"
        onBack={onBack}
        table={<p className="text-body text-ink-muted">Loading how this month went…</p>}
      />
    );
  }

  const report = reportState.data;
  const periods = periodsState.data;
  const totals = toKpiTotals(report.vehicles);

  return (
    <>
      <ReportScreen
        title="How was this month"
        subtitle={`${formatShortDate(report.period.periodStart)} – ${formatShortDate(report.period.periodEnd)}`}
        onBack={onBack}
        chart={
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="min-h-tap self-start rounded-sm border border-transparent bg-surface-sunken px-3 text-body text-ink-primary"
            >
              {formatShortDate(report.period.periodStart)} –{" "}
              {formatShortDate(report.period.periodEnd)} ▾
            </button>
            {/* §7.11/TwoBalances: same direction markers as VehicleRow's own
                Earned/Spent below; profit is a derived net, left unmarked. */}
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
            <HorizontalBarChart data={toChartData(report.vehicles)} />
          </div>
        }
        table={
          <div className="flex flex-col gap-2">
            {report.vehicles.map((v) => (
              <VehicleRow key={v.vehicleId} vehicle={v} />
            ))}
          </div>
        }
      />
      <PeriodPickerSheet
        periods={periods}
        currentPeriodId={resolvedPeriodId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onPeriodChange}
      />
    </>
  );
}
