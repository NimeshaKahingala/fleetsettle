import { LogOut } from "lucide-react";
import { useState } from "react";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useAuthActions } from "../../lib/AuthActionsContext.js";

/**
 * §3.1's `/more` hub (GAP-37) — the only door §3.3 gives to `/cash`,
 * `/partners/:id`, `/reports` and `/period/close`. **Rows for what exists
 * only**: a row leading to `NotBuiltYetScreen` is worse than no row, so this
 * renders just sign-out today. Reports appears when B4 lands, Cash when B2
 * does, Close the month when B3 does — and per M-22/W-49, that last row
 * must be **absent** for a `manager` role, never merely disabled.
 *
 * The confirm below is a `Sheet`, not `Dialog` — `Dialog` is reserved for
 * INV-1, INV-17 and M-10's three irreversible-action call sites, and
 * signing out is neither destructive nor one-way (§6.1: "Everything else is
 * a `Sheet`").
 */
export function MoreScreen() {
  const { signOut } = useAuthActions();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Screen title="More">
      <div className="flex flex-col gap-2">
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
