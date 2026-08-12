import { parse, type Minor } from "@fleetsettle/shared";
import type { PartnerSummaryResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { useApi } from "../../lib/ApiContext.js";
import { useMe } from "../../lib/useMe.js";
import { useQueryState } from "../../lib/useQueryState.js";

function Row({ label, value }: { label: string; value: Minor }) {
  return (
    <div className="flex items-center justify-between border-b border-line-hairline py-2 last:border-b-0">
      <span className="text-body text-ink-secondary">{label}</span>
      <Money value={value} />
    </div>
  );
}

/**
 * B4-REPORTS-DESIGN.md §5.6: `GET /api/partner/{userId}` rendered
 * read-only, for the signed-in user's own id — the same data `This
 * month`'s "What I'm owed" row navigates into. `putIn`/`takenOut`/
 * `balanceMinor` are all-time; `earned` stays scoped to the named period
 * (GAP-74 added `balanceMinor` as a new all-time figure, it did not widen
 * `earned` itself) — captioned separately so an all-time figure and a
 * one-month figure never sit in the same column with nothing to tell them
 * apart, the quiet wrongness this product exists to avoid.
 */
export function ReviewMoneyScreen() {
  const api = useApi();
  const me = useMe();

  const query = useQuery({
    queryKey: ["partner", me.userId],
    queryFn: () => api.get<PartnerSummaryResponse>(`/api/partner/${me.userId}`),
  });

  const state = useQueryState(query);

  // GAP-101/GAP-90/F2: this is the screen the client half of F2 closes —
  // a revoked member's 404 (the server half's own fix) now renders as an
  // honest failure here, not an eternal spinner.
  if (state.kind === "error") {
    return (
      <Screen title="My money">
        <QueryStateFailure error={state.error} retry={state.retry} of="your money" />
      </Screen>
    );
  }

  if (state.kind !== "ready") {
    return (
      <Screen title="My money">
        <p className="text-body text-ink-muted">Loading…</p>
      </Screen>
    );
  }

  const data = state.data;

  return (
    <Screen title="My money">
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-1">
          <span className="text-caption text-ink-muted">What I'm owed</span>
          <Money value={parse(data.balanceMinor)} className="text-title-lg font-medium" />
        </Card>

        <Card className="flex flex-col">
          <h2 className="pb-2 text-label font-medium text-ink-secondary">Put in (all time)</h2>
          <Row label="Contributions" value={parse(data.putIn.contributionsMinor)} />
          <Row label="Out of pocket" value={parse(data.putIn.outOfPocketMinor)} />
        </Card>

        <Card className="flex flex-col">
          <h2 className="pb-2 text-label font-medium text-ink-secondary">Taken out (all time)</h2>
          <Row label="Payouts" value={parse(data.takenOut.payoutsMinor)} />
          <Row label="Settlements" value={parse(data.takenOut.settlementsMinor)} />
        </Card>

        <Card className="flex flex-col">
          <h2 className="pb-2 text-label font-medium text-ink-secondary">
            Earned ({data.period.periodStart} – {data.period.periodEnd})
          </h2>
          <Row label="Profit share" value={parse(data.earned.profitShareMinor)} />
          <Row label="Management fee" value={parse(data.earned.managementFeeMinor)} />
        </Card>

        <Card className="flex items-center justify-between">
          <span className="text-body text-ink-secondary">Holding (business cash in hand)</span>
          <Money value={parse(data.holdingMinor)} />
        </Card>
      </div>
    </Screen>
  );
}
