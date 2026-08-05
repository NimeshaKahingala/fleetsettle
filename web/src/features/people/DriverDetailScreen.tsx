import { businessToday, parse } from "@fleetsettle/shared";
import type { DriverBalancesResponse, DriverResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TwoBalances } from "../../components/TwoBalances.js";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";
import { OffsetSheet } from "./OffsetSheet.js";

export interface DriverDetailScreenProps {
  driverId: string;
  onBack: () => void;
}

/**
 * F-6.4/UC-56's two-balance screen. `driverBalancesResponseSchema` gives
 * only the two totals (`owedToUsMinor`/`owedByUsMinor`), never a
 * breakdown — the per-obligation detail lines `TwoBalances`' own props
 * describe (e.g. "6 short days, oldest 14 Jul") aren't backed by any read
 * endpoint yet, so both detail lines are the same "—" `TwoBalances.test.tsx`
 * already uses for "nothing specific to say," rather than a fabricated one.
 * History sections (days, trips, advances, deposit — §3.3's route map) are
 * a separate, larger gap, recorded rather than half-built here.
 */
export function DriverDetailScreen({ driverId, onBack }: DriverDetailScreenProps) {
  const api = useApi();
  const today = businessToday();
  const [offsetOpen, setOffsetOpen] = useState(false);

  const driverQuery = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => api.get<DriverResponse>(`/api/driver/${driverId}`),
  });
  const balancesQuery = useQuery({
    queryKey: ["driver", driverId, "balances"],
    queryFn: () => api.get<DriverBalancesResponse>(`/api/driver/${driverId}/balances`),
  });

  return (
    <Screen title={driverQuery.data?.name ?? "Driver"} onBack={onBack}>
      {driverQuery.data === undefined || balancesQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <TwoBalances
          driverName={driverQuery.data.name}
          owedToYouMinor={parse(balancesQuery.data.owedToUsMinor)}
          owedToYouDetail="—"
          owedByYouMinor={parse(balancesQuery.data.owedByUsMinor)}
          owedByYouDetail="—"
          onOffset={() => setOffsetOpen(true)}
        />
      )}
      <OffsetSheet
        open={offsetOpen}
        onOpenChange={setOffsetOpen}
        driverId={driverId}
        today={today}
      />
    </Screen>
  );
}
