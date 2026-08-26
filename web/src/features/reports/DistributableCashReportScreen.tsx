import { parse } from "@fleetsettle/shared";
import type { DistributableCashResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { ReportScreen } from "./ReportScreen.js";

export interface DistributableCashReportScreenProps {
  onBack: () => void;
}

/**
 * GAP-186/UC-109, W-70: "cash on hand and in bank, less deposits held, less
 * loan instalments due" — a cash report, not a capital one (`viewReports`,
 * a manager sees this too). No chart/table toggle (`ReportScreen`'s `table`
 * slot alone) — this is one figure and its three inputs, not a work list
 * or a magnitude to compare across a series.
 *
 * `loanInstalmentsDueMinor`/`distributableMinor` come back `null` together
 * whenever an open loan has no monthly instalment figure to compute "due"
 * from — rendered as `NotAvailable`, never a fabricated 0 (W-56): "the
 * single most expensive wrong number... because someone acts on it by
 * moving money out of the business."
 */
export function DistributableCashReportScreen({ onBack }: DistributableCashReportScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["reports", "distributable-cash"],
    queryFn: () => api.get<DistributableCashResponse>("/api/reports/distributable-cash"),
  });
  const state = useQueryState(query);

  return (
    <ReportScreen
      title="What can we safely take out"
      onBack={onBack}
      table={
        state.kind === "error" ? (
          <QueryStateFailure
            error={state.error}
            retry={state.retry}
            of="what we can safely take out"
          />
        ) : state.kind !== "ready" ? (
          <p className="text-body text-ink-muted">Loading what we can safely take out…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <StatTile
              label="Cash on hand and in bank"
              value={<Money value={parse(state.data.cashOnHandMinor)} />}
            />
            <StatTile
              label="Held as deposits"
              value={<Money value={parse(state.data.depositsHeldMinor)} />}
            />
            <StatTile
              label="Loan instalments due"
              value={
                state.data.loanInstalmentsDueMinor !== null ? (
                  <Money value={parse(state.data.loanInstalmentsDueMinor)} />
                ) : (
                  <NotAvailable reason="a loan has no monthly instalment set" />
                )
              }
            />
            <StatTile
              label="Safe to take out"
              value={
                state.data.distributableMinor !== null ? (
                  <Money value={parse(state.data.distributableMinor)} />
                ) : (
                  <NotAvailable reason="a loan has no monthly instalment set" />
                )
              }
              size="hero"
              className="sm:col-span-2"
            />
          </div>
        )
      }
    />
  );
}
