import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BusinessResponse,
  RedeemInviteResponse,
  SessionMembership,
  SessionPendingRequest,
  SessionResponse,
} from "@fleetsettle/shared/schemas";
import { Building2, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Card } from "../../design/primitives/Card.js";
import { useApi } from "../../lib/ApiContext.js";
import { clearSelectedBusinessId, getSelectedBusinessId } from "../../lib/storage.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { BusinessSwitcherSheet } from "./BusinessSwitcherSheet.js";
import { CreateBusinessForm } from "./CreateBusinessForm.js";
import { RedeemInviteForm } from "./RedeemInviteForm.js";

function FleetSettleSetupLockup() {
  return (
    <div className="flex items-center gap-3 text-ink-primary" aria-label="FleetSettle">
      <svg
        viewBox="0 0 200 91"
        aria-hidden
        className="h-10 w-24 text-brand"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 36 64 L 20 64 L 20 46 L 65 33 L 87 15 L 129 15 L 158 34 L 180 43 L 180 64 L 164 64" />
        <path d="M 68 64 L 132 64" />
        <path d="M 78 35 L 138 35" />
        <circle cx="52" cy="64" r="11.5" />
        <circle cx="148" cy="64" r="11.5" />
      </svg>
      <span className="text-title" aria-hidden>
        <span className="font-[450]">Fleet</span>
        <span className="font-bold">Settle</span>
      </span>
    </div>
  );
}

/**
 * Design §8.2/UI §3.1: reachable regardless of business membership, so a
 * platform admin holding zero memberships still has a door to walk
 * through. A plain `Card` row button, matching `MoreScreen`'s own row
 * pattern — not styled as an alert or a primary action, since holding this
 * role is unrelated to whatever get-started/revoked state is showing above
 * or below it.
 */
function AdminEntry({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  return (
    <button type="button" onClick={onOpenAdmin} className="w-full text-left">
      <Card className="flex items-center gap-3">
        <ShieldCheck className="size-5 text-brand-ink" aria-hidden />
        <span className="flex-1 text-body text-ink-primary">Open the admin panel</span>
      </Card>
    </button>
  );
}

/**
 * The create/redeem slot — F-0.1's own two options. Rendered both when this
 * identity has never requested a business (`pendingRequest === null`) and
 * when it has an outstanding request (`pendingRequest !== null`):
 * `CreateBusinessForm` owns rendering the default form vs. the
 * pending/rejected states itself (decision 17), fed the already-fetched
 * `pendingRequest` rather than this component re-querying `/api/session` —
 * `FirstRunGate` already has the answer, so nothing here duplicates the
 * read. `RedeemInviteForm` is unconditional either way: an outstanding
 * creation request has nothing to do with whether an invite code works.
 */
function GetStartedCards({
  pendingRequest,
  adminEntry,
  onCreated,
  onRedeemed,
}: {
  pendingRequest: SessionPendingRequest | null;
  adminEntry: React.ReactNode;
  onCreated: (business: BusinessResponse) => void;
  onRedeemed: (result: RedeemInviteResponse) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
      <div className="flex flex-col gap-3">
        <FleetSettleSetupLockup />
        <div>
          <h1 className="text-title-lg text-ink-primary">Get started</h1>
          <p className="text-body-sm text-ink-muted">
            Create your business, or use an invite code someone gave you.
          </p>
        </div>
      </div>

      {adminEntry}

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <Card className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
            <div>
              <h2 className="text-title text-ink-primary">Create a business</h2>
              <p className="text-body-sm text-ink-muted">
                Start a new FleetSettle business record.
              </p>
            </div>
          </div>
          <CreateBusinessForm pendingRequest={pendingRequest} onCreated={onCreated} />
        </Card>
        <Card className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
            <div>
              <h2 className="text-title text-ink-primary">Join a business</h2>
              <p className="text-body-sm text-ink-muted">Enter the code you were given.</p>
            </div>
          </div>
          <RedeemInviteForm onRedeemed={onRedeemed} />
        </Card>
      </div>
    </div>
  );
}

export interface FirstRunGateProps {
  /** RootLayout's own `useRouterState` read, passed down rather than read here — FirstRunGate is not itself a route component (M-3's shells are), so it takes navigation/location as props the same way every non-route screen in `router.tsx` does, and stays free of a `<RouterProvider>` dependency in its own unit tests. */
  pathname: string;
  /** Design §8.2: admin routes are reached by pathname, from any business-membership state — `RootLayout` supplies `() => navigate({ to: "/admin" })`. */
  onOpenAdmin: () => void;
  /** Rendered once `/api/session` resolves to `owner_manager`/`manager` (UI §1.1, M-3: the owner-manager is never routed into Review). */
  renderOperate: () => React.ReactNode;
  /** B0b: rendered for `owner` — the Review shell, its own component tree (§7.9). */
  renderReview: () => React.ReactNode;
  /** B0b: rendered for `driver` — the Mine shell, its own component tree, no tab bar. */
  renderMine: () => React.ReactNode;
  /** UI §3.1 (added 18 Aug 2026): the platform admin surface — not a fourth business-role shell, reached by pathname alone once `isPlatformAdmin` is true (see the precedence note below). */
  renderAdmin: () => React.ReactNode;
}

/**
 * Rebuilt onto `GET /api/session` (Phase 2, 18 Aug 2026 — design doc
 * decision 17/26, implementation plan §2 Phase 2). `/api/session` never
 * 404s the way the old `/api/me`-based first-run sniff did — it always
 * resolves for any verified token — so the branching here is a real
 * discriminated read of `{ businesses, pendingRequest, hadMembership,
 * isPlatformAdmin }`, not an absence inferred from a caught error.
 *
 * Precedence, in order:
 * 1. `isPlatformAdmin && pathname` under `/admin` → the admin surface,
 *    regardless of business count (design §7.1: an admin holding no
 *    membership at all has nowhere else `/api/session` gives them to open).
 * 2. `businesses.length === 0`:
 *    - `pendingRequest !== null` → the create/redeem cards, with
 *      `CreateBusinessForm` itself rendering the pending/rejected state.
 *    - else `hadMembership` (decision 26) → the distinct revoked message —
 *      never the business name or the actor, the same disclosure
 *      discipline as 404-not-403, and deliberately not the same screen as
 *      the create/redeem cards: a revoked user is not invited to create a
 *      new business as if nothing happened.
 *    - else → today's create/redeem cards, unchanged.
 * 3. `businesses.length === 1` → straight into that membership's shell —
 *    unremarked, matching `authMiddleware`'s own step 4a (no header needed
 *    when there is nothing to choose between).
 * 4. `businesses.length > 1`:
 *    - `getSelectedBusinessId()` names one of the returned `businesses` →
 *      straight into that membership's shell, no prompt — a switch already
 *      happened in a previous session, and there is nothing left to decide.
 *    - unset, or names a business no longer in the list (revoked from it
 *      since the last selection) → the switcher, held open with no escape
 *      hatch (see `FirstRunGateInner`'s own comment on why).
 */
export function FirstRunGate(props: FirstRunGateProps) {
  // Phase 3: forces a genuinely fresh `["session"]` subscription once the
  // switcher's `queryClient.clear()` runs. Verified empirically (not
  // assumed) that a mounted `useQuery` observer does **not** recover on its
  // own after `clear()` — neither `invalidateQueries` nor `refetchQueries`
  // nor `resetQueries`, called immediately after, un-sticks it; only an
  // actual React unmount/remount does. This is the "hard remount" design
  // §8.1 calls for, scoped to just this component: the switcher can only
  // ever be showing before any shell has rendered (see the precedence
  // above), so `FirstRunGateInner`'s own session query is the only thing
  // mounted anywhere in the tree at that point — nothing else needs it.
  const [remountGeneration, setRemountGeneration] = useState(0);
  return (
    <FirstRunGateInner
      key={remountGeneration}
      {...props}
      onBusinessSwitched={() => setRemountGeneration((g) => g + 1)}
    />
  );
}

/** Picks the shell for a resolved membership — shared between the single-membership path and the multi-membership-with-a-valid-selection path so the role→shell rule lives in exactly one place. */
function renderShellFor(
  membership: SessionMembership,
  renderOperate: () => React.ReactNode,
  renderReview: () => React.ReactNode,
  renderMine: () => React.ReactNode,
): React.ReactNode {
  if (membership.role === "owner_manager" || membership.role === "manager") {
    return renderOperate();
  }
  if (membership.role === "owner") return renderReview();
  return renderMine();
}

function FirstRunGateInner({
  pathname,
  onOpenAdmin,
  renderOperate,
  renderReview,
  renderMine,
  renderAdmin,
  onBusinessSwitched,
}: FirstRunGateProps & {
  /** Called once the switcher has persisted a selection and cleared the cache — see `FirstRunGate`'s own comment for why this needs to force a remount rather than just re-rendering. */
  onBusinessSwitched: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<SessionResponse>("/api/session"),
  });
  const sessionState = useQueryState(sessionQuery);

  // GAP-101/M-28: `QueryState`'s own idle/pending/error/ready split, applied
  // to the very first read in the app — its error branch is what matters
  // here. `idle` is unreachable — this query carries no `enabled:`, so it
  // folds into the same fallback as `pending` rather than adding a branch
  // nothing reaches.
  if (sessionState.kind === "error") {
    return (
      <div className="p-4">
        <QueryStateFailure
          error={sessionState.error}
          retry={sessionState.retry}
          of="your account"
        />
      </div>
    );
  }

  if (sessionState.kind !== "ready") {
    return <p className="p-4 text-body-sm text-ink-muted">Loading…</p>;
  }

  const { businesses, isPlatformAdmin, pendingRequest, hadMembership } = sessionState.data;

  if (isPlatformAdmin && pathname.startsWith("/admin")) {
    return <>{renderAdmin()}</>;
  }

  const refreshSession = () => {
    void queryClient.invalidateQueries({ queryKey: ["session"] });
  };

  if (businesses.length === 0) {
    const adminEntry = isPlatformAdmin ? <AdminEntry onOpenAdmin={onOpenAdmin} /> : null;

    if (pendingRequest === null && hadMembership) {
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
          <FleetSettleSetupLockup />
          {adminEntry}
          <Card>
            <p className="text-body text-ink-secondary">
              You no longer have access to any business. Contact the business owner.
            </p>
          </Card>
        </div>
      );
    }

    return (
      <GetStartedCards
        pendingRequest={pendingRequest}
        adminEntry={adminEntry}
        onCreated={() => refreshSession()}
        onRedeemed={() => refreshSession()}
      />
    );
  }

  if (businesses.length === 1) {
    const [membership] = businesses;
    if (membership === undefined) {
      // Unreachable: businesses.length === 0 already returned above. Guards
      // the array-index read for strict-null-checks rather than a `!`.
      return null;
    }
    // **Fixes a gitar-bot finding on PR #77, 19 Aug 2026**: a stored
    // selection that no longer names this identity's one remaining
    // membership (e.g. was multi-business, picked A, then got revoked from
    // A and is left with only B) was never reconciled here — `api.ts`
    // sends whatever `getSelectedBusinessId()` returns on every request
    // regardless of membership count, so a stale id would keep going out
    // as `X-Business-Id: A` even though B's shell is what actually renders.
    // `authMiddleware` refuses an unmatched header with a plain 404 (IG
    // §7.5 step 3), never `BUSINESS_NOT_SELECTED` — so `main.tsx`'s own
    // recovery branch, which only watches for that specific code, never
    // fires, and every request 404s until the user manually signs out.
    // Idempotent and side-effect-only (never changes what this render
    // returns), so safe to do inline rather than behind a `useEffect`.
    if (getSelectedBusinessId() !== membership.businessId) {
      clearSelectedBusinessId();
    }
    return <>{renderShellFor(membership, renderOperate, renderReview, renderMine)}</>;
  }

  // businesses.length > 1: a real choice exists. Proceed straight through
  // only when a *valid* stored selection already names one of these
  // businesses — otherwise this is exactly "must choose before proceeding".
  const selectedId = getSelectedBusinessId();
  const selected =
    selectedId !== null ? businesses.find((b) => b.businessId === selectedId) : undefined;

  if (selected === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
        <FleetSettleSetupLockup />
        <div>
          <h1 className="text-title-lg text-ink-primary">Choose a business</h1>
          <p className="text-body-sm text-ink-muted">
            You belong to more than one business. Pick which one to open.
          </p>
        </div>
        <BusinessSwitcherSheet
          open
          onOpenChange={() => {
            // Intentionally inert: design §8.1 — "not a dismissible sheet
            // with an escape hatch". There is no valid state to fall back
            // to until a business is actually picked, so a close attempt
            // (the visible X, a swipe, Escape, the mobile back gesture)
            // does nothing rather than revealing nothing behind it.
          }}
          businesses={businesses}
          onSelected={onBusinessSwitched}
        />
      </div>
    );
  }

  return <>{renderShellFor(selected, renderOperate, renderReview, renderMine)}</>;
}
