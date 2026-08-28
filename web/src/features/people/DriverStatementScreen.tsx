import { addDays, parse, type BusinessDate } from "@fleetsettle/shared";
import type {
  DriverBalancesResponse,
  DriverResponse,
  DriverViewResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { TwoBalances } from "../../components/TwoBalances.js";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";
import { formatShortDate } from "../../lib/formatShortDate.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { ReportDateRangeFields } from "../reports/ReportDateRangeFields.js";
import { DriverActivitySections } from "./DriverActivitySections.js";

export interface DriverStatementScreenProps {
  driverId: string;
  today: BusinessDate;
  onBack: () => void;
}

/**
 * F-6.6/UC-57, GAP-170: "give the driver something he can hold" — a
 * one-page, printable statement for a driver with no login. Deliberately
 * read-only (no write props reach `DriverActivitySections`, same contract
 * `MineScreen`/F-6.8 already establishes) and deliberately not the no-login
 * share link (GAP-65, phase 2, its own security design) — this stays behind
 * the ordinary login boundary the same way `DriverDetailScreen` already
 * does; only the printed *output* leaves the room.
 *
 * The covered period is adjustable rather than the hardcoded 30 days
 * `DriverDetailScreen`/`MineScreen` browse with (§14: "print stylesheets
 * matter more than usual here... evidence in an argument three months
 * later" — an undated slip proves nothing, and UC-57 is "at settlement,"
 * which differs by driver). `.print-area` (`tokens.css`) is what the print
 * stylesheet isolates; everything outside it, including this screen's own
 * date-range controls and `Screen`'s own chrome, is hidden on print.
 *
 * `DriverActivitySections` gets `forceExpanded` (Gitar review, PR #143): its
 * own `Section` collapses each list to 3 rows and only mounts the rest on a
 * click that sets React state — a print stylesheet can only show or hide
 * what already exists in the DOM, so without this a statement with more
 * than 3 days/trips/advances/offsets would silently print an incomplete
 * record, exactly the failure UC-57 exists to prevent.
 */
export function DriverStatementScreen({ driverId, today, onBack }: DriverStatementScreenProps) {
  const api = useApi();
  const [from, setFrom] = useState<BusinessDate>(addDays(today, -30));
  const [to, setTo] = useState<BusinessDate>(today);

  const driverQuery = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => api.get<DriverResponse>(`/api/driver/${driverId}`),
  });
  const balancesQuery = useQuery({
    queryKey: ["driver", driverId, "balances"],
    queryFn: () => api.get<DriverBalancesResponse>(`/api/driver/${driverId}/balances`),
  });
  const historyQuery = useQuery({
    queryKey: ["driver", driverId, "view", from, to],
    queryFn: () =>
      api.get<DriverViewResponse>(`/api/driver/${driverId}/view?from=${from}&to=${to}`),
  });
  const driverState = useQueryState(driverQuery);
  const balancesState = useQueryState(balancesQuery);
  const historyState = useQueryState(historyQuery);
  const failedState =
    driverState.kind === "error"
      ? driverState
      : balancesState.kind === "error"
        ? balancesState
        : historyState.kind === "error"
          ? historyState
          : null;

  const ready =
    driverQuery.data !== undefined &&
    balancesQuery.data !== undefined &&
    historyQuery.data !== undefined;

  return (
    <Screen
      title="Statement"
      onBack={onBack}
      {...(ready ? { primaryAction: { label: "Print", onClick: () => window.print() } } : {})}
    >
      {failedState !== null ? (
        <QueryStateFailure
          error={failedState.error}
          retry={failedState.retry}
          of="this driver's statement"
        />
      ) : !ready ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* On-screen only — hidden by the print stylesheet along with the
              rest of Screen's own chrome (tokens.css). */}
          <ReportDateRangeFields
            from={from}
            to={to}
            today={today}
            onParamsChange={(params) => {
              setFrom(params.from);
              setTo(params.to);
            }}
          />
          <div className="print-area flex flex-col gap-5">
            {/* Shown on screen too, not just in print: Screen's own app bar
                (hidden on print, see tokens.css) says only "Statement" — the
                driver's name has to come from somewhere, and once chrome is
                gone on the printed page this is the only place it can. So
                TwoBalances below omits its own `driverName` — this heading
                already names the driver (the same "screen title already
                names the driver" rule DriverDetailScreen's own TwoBalances
                usage follows, just carried by this block instead of the app
                bar), and doubling it inside the card would print the name
                twice. */}
            <div>
              <p className="text-title text-ink-primary">{driverQuery.data.name}</p>
              <p className="text-body-sm text-ink-secondary">Driver statement</p>
              <p className="text-body-sm text-ink-secondary">
                {formatShortDate(from)} – {formatShortDate(to)}
              </p>
              <p className="text-caption text-ink-muted">Generated {formatShortDate(today)}</p>
            </div>
            <TwoBalances
              owedToYouMinor={parse(balancesQuery.data.owedToUsMinor)}
              owedToYouDetail="—"
              owedByYouMinor={parse(balancesQuery.data.owedByUsMinor)}
              owedByYouDetail="—"
            />
            <DriverActivitySections view={historyQuery.data} forceExpanded />
          </div>
        </div>
      )}
    </Screen>
  );
}
