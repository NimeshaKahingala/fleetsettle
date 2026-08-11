import { parse, type BusinessDate } from "@fleetsettle/shared";
import type { FuelEfficiencyResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { DateField } from "../../components/DateField.js";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { TrendLineChart, type TrendLineDatum } from "./charts/TrendLineChart.js";
import { ReportScreen } from "./ReportScreen.js";
import { ReportTable, type ReportTableColumn } from "./ReportTable.js";

export interface FuelEfficiencyReportScreenProps {
  vehicleId?: string;
  from: BusinessDate;
  to: BusinessDate;
  today: BusinessDate;
  onParamsChange: (params: { vehicleId: string; from: BusinessDate; to: BusinessDate }) => void;
  onBack: () => void;
}

const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function shortDate(date: string): string {
  return shortDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

/** UC-72: a `null` point is a genuine gap (no paired reading), never a zero-height mark (§11.4). */
export function toChartData(points: FuelEfficiencyResponse["points"]): TrendLineDatum[] {
  return points.map((p) => ({
    x: shortDate(p.spentOn),
    y: p.kmPerLitre,
  }));
}

const COLUMNS: ReportTableColumn<FuelEfficiencyResponse["points"][number]>[] = [
  { key: "date", header: "Date", render: (row) => row.spentOn },
  {
    key: "amount",
    header: "Amount",
    align: "end",
    render: (row) => <Money value={parse(row.amountMinor)} />,
  },
  {
    key: "litres",
    header: "Litres",
    align: "end",
    render: (row) =>
      // eslint-disable-next-line no-restricted-syntax -- a fuel volume, not money
      row.litres === null ? <NotAvailable reason="no litres recorded" /> : row.litres.toFixed(1),
  },
  {
    key: "kmPerLitre",
    header: "km/l",
    align: "end",
    render: (row) =>
      row.kmPerLitre === null ? (
        <NotAvailable reason="no paired odometer reading" />
      ) : (
        // eslint-disable-next-line no-restricted-syntax -- a fuel-efficiency ratio, not money
        row.kmPerLitre.toFixed(2)
      ),
  },
];

/**
 * UC-72 / `GET /api/reports/fuel-efficiency` — the one report parameterised
 * by both a vehicle and a date range. Only fuel *you* bought (W-20) counts,
 * so this can be genuinely empty for a vehicle on a driver-fuels-himself
 * arrangement — that renders as `NotAvailable` for the whole chart (UC-72's
 * own text: "a month with no complete fill-to-fill pair shows nothing at
 * all"), not an empty axis implying nothing happened.
 */
export function FuelEfficiencyReportScreen({
  vehicleId,
  from,
  to,
  today,
  onParamsChange,
  onBack,
}: FuelEfficiencyReportScreenProps) {
  const api = useApi();

  const vehiclesQuery = useQuery({
    queryKey: ["vehicle"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
  });

  const reportQuery = useQuery({
    queryKey: ["reports", "fuel-efficiency", vehicleId, from, to],
    queryFn: () => {
      if (vehicleId === undefined) throw new Error("no vehicle chosen yet");
      return api.get<FuelEfficiencyResponse>(
        `/api/reports/fuel-efficiency?vehicleId=${vehicleId}&from=${from}&to=${to}`,
      );
    },
    enabled: vehicleId !== undefined,
  });
  const vehiclesState = useQueryState(vehiclesQuery);
  const reportState = useQueryState(reportQuery);

  const vehicleOptions: EntityOption[] = (vehiclesQuery.data ?? []).map((v) => ({
    id: v.id,
    label: v.registration,
  }));
  const selectedVehicle = vehicleOptions.find((v) => v.id === vehicleId) ?? null;

  const paramsForm = (
    <div className="flex flex-col gap-3">
      {vehiclesState.kind === "error" ? (
        <QueryStateFailure
          error={vehiclesState.error}
          retry={vehiclesState.retry}
          of="the vehicle list"
        />
      ) : null}
      <EntityPicker
        label="Vehicle"
        options={vehicleOptions}
        value={selectedVehicle}
        onChange={(option) => onParamsChange({ vehicleId: option.id, from, to })}
      />
      <div className="flex gap-3">
        <DateField
          label="From"
          value={from}
          today={today}
          showShortcuts={false}
          onChange={(date) => {
            if (vehicleId !== undefined) onParamsChange({ vehicleId, from: date, to });
          }}
        />
        <DateField
          label="To"
          value={to}
          today={today}
          showShortcuts={false}
          onChange={(date) => {
            if (vehicleId !== undefined) onParamsChange({ vehicleId, from, to: date });
          }}
        />
      </div>
    </div>
  );

  if (vehicleId === undefined) {
    return <ReportScreen title="Is the bus drinking fuel" onBack={onBack} table={paramsForm} />;
  }

  if (reportState.kind === "error") {
    return (
      <ReportScreen
        title="Is the bus drinking fuel"
        subtitle={`${from} – ${to}`}
        onBack={onBack}
        table={
          <div className="flex flex-col gap-3">
            {paramsForm}
            <QueryStateFailure
              error={reportState.error}
              retry={reportState.retry}
              of="this vehicle's fuel efficiency"
            />
          </div>
        }
      />
    );
  }

  if (reportState.kind !== "ready") {
    return (
      <ReportScreen
        title="Is the bus drinking fuel"
        subtitle={`${from} – ${to}`}
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

  const hasAnyReading = reportState.data.points.some((p) => p.kmPerLitre !== null);

  return (
    <ReportScreen
      title="Is the bus drinking fuel"
      subtitle={`${from} – ${to}`}
      onBack={onBack}
      chart={
        <div className="flex flex-col gap-3">
          {paramsForm}
          {hasAnyReading ? (
            <TrendLineChart data={toChartData(reportState.data.points)} />
          ) : (
            <NotAvailable reason="no complete fill-to-fill pair in this window" />
          )}
        </div>
      }
      table={
        <div className="flex flex-col gap-3">
          {paramsForm}
          {reportState.data.points.length === 0 ? (
            <p className="text-body text-ink-secondary">No fuel fills recorded in this window.</p>
          ) : (
            <ReportTable
              columns={COLUMNS}
              rows={reportState.data.points}
              rowKey={(row) => row.spentOn}
            />
          )}
        </div>
      }
    />
  );
}
