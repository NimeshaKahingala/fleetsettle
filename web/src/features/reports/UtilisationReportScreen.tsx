import { parse, type BusinessDate } from "@fleetsettle/shared";
import type { UtilisationResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { DateField } from "../../components/DateField.js";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { ReportScreen } from "./ReportScreen.js";

export interface UtilisationReportScreenProps {
  vehicleId?: string;
  from: BusinessDate;
  to: BusinessDate;
  today: BusinessDate;
  onParamsChange: (params: { vehicleId: string; from: BusinessDate; to: BusinessDate }) => void;
  onBack: () => void;
}

function statFor(report: UtilisationResponse, key: "earningDays" | "idleDays" | "offRoadDays") {
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  return report[key].toString();
}

/**
 * UC-79 / `GET /api/reports/utilisation` — "the comparison it exists to
 * enable: revenue per available day across arrangements" (UC-79's own
 * text), so that figure leads as a hero `StatTile`; the three day counts
 * sit beneath it as an ordinary row. `revenuePerAvailableDayMinor: null`
 * (GAP-19, W-56) renders `NotAvailable`, never a guessed `Rs 0` — the whole
 * window off the road is a real, if unlikely, case. Owner/owner-manager
 * only, the same `viewOwnerOnlyReports` gate the route itself enforces.
 */
export function UtilisationReportScreen({
  vehicleId,
  from,
  to,
  today,
  onParamsChange,
  onBack,
}: UtilisationReportScreenProps) {
  const api = useApi();

  const vehiclesQuery = useQuery({
    queryKey: ["vehicle"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
  });

  const reportQuery = useQuery({
    queryKey: ["reports", "utilisation", vehicleId, from, to],
    queryFn: () => {
      if (vehicleId === undefined) throw new Error("no vehicle chosen yet");
      return api.get<UtilisationResponse>(
        `/api/reports/utilisation?vehicleId=${vehicleId}&from=${from}&to=${to}`,
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
          onChange={(date) => {
            if (vehicleId !== undefined) onParamsChange({ vehicleId, from: date, to });
          }}
        />
        <DateField
          label="To"
          value={to}
          today={today}
          onChange={(date) => {
            if (vehicleId !== undefined) onParamsChange({ vehicleId, from, to: date });
          }}
        />
      </div>
    </div>
  );

  if (vehicleId === undefined) {
    return (
      <ReportScreen title="How hard is each vehicle working" onBack={onBack} table={paramsForm} />
    );
  }

  if (reportState.kind === "error") {
    return (
      <ReportScreen
        title="How hard is each vehicle working"
        subtitle={`${from} – ${to}`}
        onBack={onBack}
        table={
          <div className="flex flex-col gap-3">
            {paramsForm}
            <QueryStateFailure
              error={reportState.error}
              retry={reportState.retry}
              of="this vehicle's utilisation"
            />
          </div>
        }
      />
    );
  }

  if (reportState.kind !== "ready") {
    return (
      <ReportScreen
        title="How hard is each vehicle working"
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

  const report = reportState.data;

  return (
    <ReportScreen
      title="How hard is each vehicle working"
      subtitle={`${from} – ${to}`}
      onBack={onBack}
      table={
        <div className="flex flex-col gap-4">
          {paramsForm}
          <StatTile
            label="Revenue per available day"
            size="hero"
            value={
              report.revenuePerAvailableDayMinor === null ? (
                <NotAvailable reason="no available day in this window" />
              ) : (
                <Money value={parse(report.revenuePerAvailableDayMinor)} />
              )
            }
          />
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Earning" value={statFor(report, "earningDays")} />
            <StatTile label="Idle" value={statFor(report, "idleDays")} />
            <StatTile label="Off the road" value={statFor(report, "offRoadDays")} />
          </div>
        </div>
      }
    />
  );
}
