import type { AccountingPeriodListRow, VehicleMonthResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";
import { useMe } from "../../lib/useMe.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { VehiclePerformanceCard } from "./VehiclePerformanceCard.js";

export interface ReviewVehiclesScreenProps {
  onSelectVehicle: (vehicleId: string, periodId: string) => void;
  /** Present only when reached through Operate's `/more` (M-36) — absent for `owner`, whose Review shell never gives this screen a back button. */
  onBack?: () => void;
}

/**
 * B4-REPORTS-DESIGN.md §5.5: cuts orthogonally from `This month`, not by
 * list length — at this fleet size `This month` already shows every
 * vehicle, so this tab's job is "one vehicle across periods," which the
 * list alone can't answer. It still opens on the current period's own
 * figures (the same `vehicle-month` fetch `This month` already makes, so
 * TanStack Query serves it from cache rather than a second round trip when
 * both tabs are visited in one session) — the period picker lives on the
 * detail screen this list taps into, not here.
 */
export function ReviewVehiclesScreen({ onSelectVehicle, onBack }: ReviewVehiclesScreenProps) {
  const api = useApi();
  const me = useMe();

  const periodsQuery = useQuery({
    queryKey: ["accounting-period"],
    queryFn: () => api.get<AccountingPeriodListRow[]>("/api/accounting-period"),
  });
  const current = periodsQuery.data?.find((p) => p.status === "open") ?? periodsQuery.data?.[0];

  const reportQuery = useQuery({
    queryKey: ["reports", "vehicle-month", current?.id],
    queryFn: () => {
      if (current === undefined) throw new Error("no period resolved yet");
      return api.get<VehicleMonthResponse>(`/api/reports/vehicle-month?periodId=${current.id}`);
    },
    enabled: current !== undefined,
  });
  const periodsState = useQueryState(periodsQuery);
  const reportState = useQueryState(reportQuery);

  // GAP-101: `periodsQuery` failing is checked first — without it `current`
  // never resolves, so `reportQuery` stays `idle` forever, not `pending`.
  if (periodsState.kind === "error") {
    return (
      <Screen title="Vehicles" {...(onBack !== undefined ? { onBack } : {})}>
        <QueryStateFailure
          error={periodsState.error}
          retry={periodsState.retry}
          of="the accounting periods"
        />
      </Screen>
    );
  }
  if (reportState.kind === "error") {
    return (
      <Screen title="Vehicles" {...(onBack !== undefined ? { onBack } : {})}>
        <QueryStateFailure
          error={reportState.error}
          retry={reportState.retry}
          of="this month's vehicles"
        />
      </Screen>
    );
  }
  if (reportState.kind !== "ready") {
    return (
      <Screen title="Vehicles" {...(onBack !== undefined ? { onBack } : {})}>
        <p className="text-body text-ink-muted">Loading…</p>
      </Screen>
    );
  }

  return (
    <Screen title="Vehicles" {...(onBack !== undefined ? { onBack } : {})}>
      <div className="flex flex-col gap-2">
        {reportState.data.vehicles.map((v) => {
          const mine = v.ownerShares.find((s) => s.userId === me.userId);
          return (
            <VehiclePerformanceCard
              key={v.vehicleId}
              vehicle={v}
              myShareMinor={mine?.profitShareMinor}
              onClick={() => {
                if (current !== undefined) onSelectVehicle(v.vehicleId, current.id);
              }}
            />
          );
        })}
      </div>
    </Screen>
  );
}
