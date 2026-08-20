import type { SessionMembership, SessionPendingRequest } from "@fleetsettle/shared/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { BUSINESS_MEMBER_ROLE_LABEL } from "../../lib/businessMemberRoleLabel.js";
import { setSelectedBusinessId } from "../../lib/storage.js";
import { CreateBusinessForm } from "./CreateBusinessForm.js";

export interface BusinessSwitcherSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businesses: SessionMembership[];
  /**
   * GAP-139 (19 Aug 2026 live QA pass, F-2): which row to mark as already
   * selected. `undefined`/no match renders every row plain — `FirstRunGate`'s
   * mandatory first-choice call site has no "current" business by definition,
   * and a stale stored id that no longer names a real membership degrades
   * the same way, correctly, rather than needing its own guard here.
   */
  currentBusinessId?: string | null;
  /**
   * Present for the in-shell business hub. Omitted for FirstRunGate's
   * mandatory "choose one of your existing memberships" state, where showing
   * another create path would make the required choice less clear.
   */
  createBusiness?: { pendingRequest: SessionPendingRequest | null };
  /**
   * Fires after the selection is persisted and the cache cleared — `null`
   * when the caller has nothing further to do. `FirstRunGate` uses this to
   * force its own remount (see its own doc comment for why `clear()` alone
   * does not un-stick its already-mounted `["session"]` read).
   */
  onSelected?: () => void;
}

function membershipRoleLabel(role: SessionMembership["role"]): string {
  return role === "driver" ? "Driver" : BUSINESS_MEMBER_ROLE_LABEL[role];
}

/**
 * Design §8.1/decision 25: the business switcher. Modelled on
 * `MoreScreen.tsx`'s sign-out confirm `Sheet` — same primitive, same
 * interaction shape (open/close state, a list, a confirm-shaped action) —
 * rather than `EntityPicker` (§6.3's vehicle/driver/customer picker):
 * `EntityPicker` is a *form field*, pre-filled and reopened from a trigger
 * button that keeps its own value; a business is not a field on some other
 * record, and `FirstRunGate`'s mandatory-choice state (see its own doc
 * comment) needs this sheet held open with no trigger at all.
 *
 * Selecting a row is irreversible only in the sense that it replaces what's
 * on screen — never destructive — so this is a `Sheet`, not a `Dialog`
 * (§6.1). **`queryClient.clear()`, never `invalidateQueries`**: no query
 * key in this client carries a business id (`["vehicles"]`,
 * `["partner", userId]`, …), so nothing short of a full clear can be
 * trusted not to render business A's cached figures under business B's
 * name — `PartnerDetailScreen.tsx`'s four `userId`-keyed queries
 * (`["partner", userId]`, `["capital-contribution", userId]`,
 * `["partner-payout", userId]`, `["banking-event", userId]`) are the
 * concrete, named case (design doc open question 19 / implementation plan
 * §5), covered by this component's own test.
 */
export function BusinessSwitcherSheet({
  open,
  onOpenChange,
  businesses,
  currentBusinessId,
  createBusiness,
  onSelected,
}: BusinessSwitcherSheetProps) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  function selectBusiness(businessId: string) {
    setSelectedBusinessId(businessId);
    queryClient.clear();
    // `onSelected` before `onOpenChange`, deliberately (19 Aug 2026, gitar
    // review on PR #78): `FirstRunGate`'s own usage passes an inert
    // `onOpenChange`, so this order never mattered there — but the
    // voluntary switcher (`OperateLayout`/`ReviewLayout`/`MineLayout`)
    // passes a real state setter, and a real `onOpenChange(false)` re-
    // renders a component that calls `useSelectedBusiness()`, which throws
    // against the cache `clear()` just emptied. Firing `onSelected` first
    // gives those callers a chance to flag "a reload is coming, ignore the
    // next `onOpenChange`" before that re-render can happen — see their
    // own comment on why `window.location.reload()` alone doesn't stop it.
    onSelected?.();
    onOpenChange(false);
  }

  function handleBusinessCreated(business: { id: string }) {
    setSelectedBusinessId(business.id);
    queryClient.clear();
    onSelected?.();
    onOpenChange(false);
  }

  return (
    // "Businesses", not "Choose a business" — `FirstRunGate`'s own
    // mandatory-choice state already renders that exact heading as its page
    // title (see its doc comment: dedicated content behind the sheet, not
    // nothing), and two identical headings on screen at once is confusing
    // for a screen reader as much as for a sighted reader.
    <Sheet open={open} onOpenChange={onOpenChange} title="Businesses">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1">
          {businesses.map((membership) => {
            const isCurrent = membership.businessId === currentBusinessId;
            return (
              <li key={membership.businessId}>
                <button
                  type="button"
                  onClick={() => selectBusiness(membership.businessId)}
                  aria-current={isCurrent ? "true" : undefined}
                  className="flex min-h-tap w-full items-center gap-3 rounded-sm px-2 text-left active:bg-brand-wash"
                >
                  <Building2 className="size-5 shrink-0 text-ink-secondary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink-primary">
                      {membership.name}
                    </span>
                    <span className="block text-body-sm text-ink-muted">
                      {membershipRoleLabel(membership.role)}
                      {isCurrent ? " · Current" : ""}
                    </span>
                  </span>
                  {isCurrent ? <Check className="size-5 shrink-0 text-brand" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>

        {createBusiness !== undefined ? (
          <div className="border-t border-line-hairline pt-4">
            {creating || createBusiness.pendingRequest !== null ? (
              <Card className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <Plus className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
                  <div>
                    <h2 className="text-title text-ink-primary">Create a business</h2>
                    <p className="text-body-sm text-ink-muted">
                      Start another FleetSettle business record.
                    </p>
                  </div>
                </div>
                <CreateBusinessForm
                  pendingRequest={createBusiness.pendingRequest}
                  onCreated={handleBusinessCreated}
                />
              </Card>
            ) : (
              <Button type="button" variant="outline" size="cta" onClick={() => setCreating(true)}>
                <Plus className="size-5" aria-hidden />
                Create a business
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
