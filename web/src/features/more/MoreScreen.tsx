import {
  Banknote,
  BarChart3,
  CalendarCheck,
  ChevronRight,
  Handshake,
  LogOut,
  Route,
  Users,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Can } from "../../components/Can.js";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useAuthActions } from "../../lib/AuthActionsContext.js";

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
 * The sign-out confirm is a `Sheet`, not `Dialog` — `Dialog` is reserved
 * for INV-1, INV-17 and M-10's three irreversible-action call sites, and
 * signing out is neither destructive nor one-way (§6.1: "Everything else is
 * a `Sheet`").
 */
export function MoreScreen() {
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

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

        <button type="button" onClick={() => setConfirmOpen(true)} className="w-full text-left">
          <Card className="flex items-center gap-3">
            <LogOut className="size-5 text-ink-secondary" aria-hidden />
            <span className="text-body text-ink-primary">Sign out</span>
          </Card>
        </button>
      </div>

      <Sheet open={confirmOpen} onOpenChange={setConfirmOpen} title="Sign out?">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body text-ink-secondary">
            You will need to sign in again to use FleetSettle on this device.
          </p>
          <DialogConfirmFooter
            confirmLabel="Sign out"
            onConfirm={() => {
              // Closes eagerly rather than waiting on the promise: real auth
              // mode navigates away as part of `signOut()`, and stub mode
              // has nothing further to show once it resolves.
              setConfirmOpen(false);
              void signOut();
            }}
            onCancel={() => setConfirmOpen(false)}
          />
        </div>
      </Sheet>
    </Screen>
  );
}
