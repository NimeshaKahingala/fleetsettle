import { addDays, parse, type BusinessDate } from "@fleetsettle/shared";
import type { DriverViewResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { QueryStateFailure } from "../../components/QueryState.js";
import { TwoBalances } from "../../components/TwoBalances.js";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { DriverActivitySections } from "../people/DriverActivitySections.js";

export interface MineScreenProps {
  today: BusinessDate;
}

/**
 * B5 / F-6.8: the linked driver's own read-only shell. The API route has no
 * `driverId` by design (INV-25); the server resolves the linked driver from
 * the caller's identity, so the client only supplies the recent date window.
 */
export function MineScreen({ today }: MineScreenProps) {
  const api = useApi();
  const from = addDays(today, -30);
  const viewQuery = useQuery({
    queryKey: ["driver-view", from, today],
    queryFn: () => api.get<DriverViewResponse>(`/api/driver-view?from=${from}&to=${today}`),
  });
  const viewState = useQueryState(viewQuery);
  const view = viewQuery.data;

  return (
    <Screen title="Mine">
      {viewState.kind === "error" ? (
        <QueryStateFailure error={viewState.error} retry={viewState.retry} of="your driver view" />
      ) : view === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <TwoBalances
            owedToYouMinor={parse(view.owedToUsMinor)}
            owedToYouDetail="What you still owe the business"
            owedByYouMinor={parse(view.owedByUsMinor)}
            owedByYouDetail="What the business still owes you"
          />
          <DriverActivitySections view={view} />
        </div>
      )}
    </Screen>
  );
}
