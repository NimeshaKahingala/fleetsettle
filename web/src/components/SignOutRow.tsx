import { LogOut } from "lucide-react";
import { useState } from "react";
import { Card } from "../design/primitives/Card.js";
import { DialogConfirmFooter } from "../design/primitives/Dialog.js";
import { Sheet } from "../design/primitives/Sheet.js";
import { useAuthActions } from "../lib/AuthActionsContext.js";
import { cn } from "../lib/cn.js";
import { rowButtonFocus } from "../lib/rowButtonFocus.js";

/**
 * The one sign-out affordance, shared by every shell that needs its own copy
 * rather than a route to `/more` — `MoreScreen.tsx` (Operate/Review), the
 * zero-membership states in `FirstRunGate.tsx`, and `MineScreen.tsx`
 * (GAP-156: the driver shell had no sign-out affordance anywhere, since
 * `AppShell`'s tab bar is `null` for `shell === "mine"` and no `/more` route
 * exists under `/me`). Same confirmation-`Sheet` shape everywhere a person
 * can find "Sign out" in this app, rather than each call site re-deriving it.
 */
export function SignOutRow() {
  const { signOut } = useAuthActions();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className={cn("w-full rounded-sm text-left", rowButtonFocus)}
      >
        <Card className="flex items-center gap-3">
          <LogOut className="size-5 text-ink-secondary" aria-hidden />
          <span className="text-body text-ink-primary">Sign out</span>
        </Card>
      </button>

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
    </>
  );
}
