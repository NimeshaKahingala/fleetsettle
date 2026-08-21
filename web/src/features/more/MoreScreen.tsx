import type { SessionResponse } from "@fleetsettle/shared/schemas";
import {
  Banknote,
  BarChart3,
  CalendarCheck,
  ChevronRight,
  Handshake,
  Route,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Can } from "../../components/Can.js";
import { SignOutRow } from "../../components/SignOutRow.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";

/**
 * §3.1's `/more` hub (GAP-37) — the only door §3.3 gives to `/cash`,
 * `/partners/:id`, `/reports` and `/period/close`. **Rows for what exists
 * only**: a row leading to `NotBuiltYetScreen` is worse than no row.
 * Opening balances (B12, GAP-61), Close the month (B3), Reports and My
 * share (both B4) are the rows past sign-out so far; Cash appears when B2
 * does — and per M-22/W-49, a row gated on a capability the current role lacks
 * must be **absent**, never merely disabled, which is what `<Can>` gives
 * for free rather than a hand-rolled role check per row. Close the month
 * is the row M-22 was written for by name: a `manager` must not see the
 * door, the same rule `CloseMonthScreen`'s own close action enforces
 * again once inside — belt and braces, not redundant, since a direct URL
 * visit bypasses this row entirely.
 *
 * Sign-out is `SignOutRow` (shared with `FirstRunGate.tsx`'s zero-membership
 * states and `MineScreen.tsx`, GAP-156) — a `Sheet` confirm, not `Dialog`:
 * `Dialog` is reserved for INV-1, INV-17 and M-10's three irreversible-action
 * call sites, and signing out is neither destructive nor one-way (§6.1:
 * "Everything else is a `Sheet`").
 */
export function MoreScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // UI §3.1 (added 18 Aug 2026): platform-admin is a separate authorization
  // axis from the business-scoped `Can`/capability system — `isPlatformAdmin`
  // comes from `/api/session`, never from `Can`, which has no concept of it.
  const isPlatformAdmin =
    queryClient.getQueryData<SessionResponse>(["session"])?.isPlatformAdmin ?? false;

  return (
    <Screen title="More">
      <div className="flex flex-col gap-2">
        <Can cap="manageOpeningBalances">
          <button
            type="button"
            onClick={() => void navigate({ to: "/opening-balances" })}
            className="w-full text-left"
          >
            <Card className="flex items-center gap-3">
              <Wallet className="size-5 text-ink-secondary" aria-hidden />
              <span className="flex-1 text-body text-ink-primary">Opening balances</span>
              <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Card>
          </button>
        </Can>

        <Can cap="closePeriod">
          <button
            type="button"
            onClick={() => void navigate({ to: "/period/close" })}
            className="w-full text-left"
          >
            <Card accent="warning" className="flex items-center gap-3">
              <CalendarCheck className="size-5 text-warning-ink" aria-hidden />
              <span className="flex-1 text-body text-ink-primary">Close the month</span>
              <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Card>
          </button>
        </Can>

        <Can cap="viewReports">
          <button
            type="button"
            onClick={() => void navigate({ to: "/reports" })}
            className="w-full text-left"
          >
            <Card className="flex items-center gap-3">
              <BarChart3 className="size-5 text-ink-secondary" aria-hidden />
              <span className="flex-1 text-body text-ink-primary">Reports</span>
              <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Card>
          </button>
        </Can>

        <Can cap="managePartnerCapital">
          <button
            type="button"
            onClick={() => void navigate({ to: "/cash" })}
            className="w-full text-left"
          >
            <Card className="flex items-center gap-3">
              <Banknote className="size-5 text-ink-secondary" aria-hidden />
              <span className="flex-1 text-body text-ink-primary">Cash</span>
              <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Card>
          </button>
        </Can>

        <Can cap="managePartnerCapital">
          <button
            type="button"
            onClick={() => void navigate({ to: "/vehicle-sharing" })}
            className="w-full text-left"
          >
            <Card className="flex items-center gap-3">
              <Handshake className="size-5 text-ink-secondary" aria-hidden />
              <span className="flex-1 text-body text-ink-primary">Vehicle sharing</span>
              <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Card>
          </button>
        </Can>

        <Can cap="manageMembers">
          <button
            type="button"
            onClick={() => void navigate({ to: "/members" })}
            className="w-full text-left"
          >
            <Card className="flex items-center gap-3">
              <Users className="size-5 text-ink-secondary" aria-hidden />
              <span className="flex-1 text-body text-ink-primary">Members</span>
              <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Card>
          </button>
        </Can>

        <Can cap="manageEntities">
          <button
            type="button"
            onClick={() => void navigate({ to: "/mileage-packages" })}
            className="w-full text-left"
          >
            <Card className="flex items-center gap-3">
              <Route className="size-5 text-ink-secondary" aria-hidden />
              <span className="flex-1 text-body text-ink-primary">Mileage packages</span>
              <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Card>
          </button>
        </Can>

        {/* B4-REPORTS-DESIGN.md §9.2, decision 10: the owner-manager's own
            entry point to the same read-only screens `owner`'s Review shell
            gives four tabs of. `managePartnerCapital` (OWNERS) is what the
            underlying `GET /api/partner/{userId}` fetch needs anyway — since
            `owner` never renders Operate's `/more` at all, this row is
            reachable by `owner_manager` alone in practice. */}
        <Can cap="managePartnerCapital">
          <button
            type="button"
            onClick={() => void navigate({ to: "/review" })}
            className="w-full text-left"
          >
            <Card className="flex items-center gap-3">
              <Wallet className="size-5 text-ink-secondary" aria-hidden />
              <span className="flex-1 text-body text-ink-primary">My share</span>
              <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Card>
          </button>
        </Can>

        {isPlatformAdmin ? (
          <button
            type="button"
            onClick={() => void navigate({ to: "/admin" })}
            className="w-full text-left"
          >
            <Card className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-brand-ink" aria-hidden />
              <span className="flex-1 text-body text-ink-primary">Admin panel</span>
              <ChevronRight className="size-4 text-ink-muted" aria-hidden />
            </Card>
          </button>
        ) : null}

        <SignOutRow />
      </div>
    </Screen>
  );
}
