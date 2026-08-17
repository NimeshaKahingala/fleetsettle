import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BusinessResponse,
  MeResponse,
  RedeemInviteResponse,
} from "@fleetsettle/shared/schemas";
import { Building2, KeyRound } from "lucide-react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Card } from "../../design/primitives/Card.js";
import { ApiError } from "../../lib/api.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
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

export interface FirstRunGateProps {
  /** Rendered once `/api/me` resolves to `owner_manager`/`manager` (UI §1.1, M-3: the owner-manager is never routed into Review). */
  renderOperate: () => React.ReactNode;
  /** B0b: rendered for `owner` — the Review shell, its own component tree (§7.9). */
  renderReview: () => React.ReactNode;
  /** B0b: rendered for `driver` — the Mine shell, its own component tree, no tab bar. */
  renderMine: () => React.ReactNode;
}

/**
 * F-0.1's own documented exception: a brand-new identity has no
 * `business_member` row yet, so `authMiddleware` throws the same 404 a
 * foreign business would (`api/src/middleware/auth.ts`). That 404 is the
 * signal this identity has no access yet — not an error to surface, the
 * expected first-run state.
 *
 * A11/W-57: this is also where a *revoked* member lands, and deliberately
 * not distinguished from brand-new — `resolveMembership` filters
 * `revoked_at IS NULL` and returns the same `null` for both, on the hottest
 * query in the system, so telling them apart would cost a join for a purely
 * cosmetic difference. One honest screen — create a business, or redeem a
 * code someone already gave you — serves both.
 *
 * Role → shell per UI §1.1: `owner_manager`/`manager` get Operate, `owner`
 * gets Review, `driver` gets Mine (B0b) — three shells, never a fourth
 * (M-3), and never a role switcher (TRACKER.md's A11 access-design pass:
 * cosmetic if the audit row agrees regardless, ambiguous "who did this" if
 * it doesn't — the last field to make ambiguous in a ledger).
 */
export function FirstRunGate({ renderOperate, renderReview, renderMine }: FirstRunGateProps) {
  const api = useApi();
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<MeResponse>("/api/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    // The 404 first-run case is already handled above, inside the query
    // function itself — anything that still reaches `isError` is a real
    // server error or the injected token getter throwing outright. No local
    // `retry: false` override needed here any more: `main.tsx`'s
    // `shouldRetryQuery` (GAP-101) already skips the retry ladder for every
    // 4xx `ApiError`, which is this query's own case, project-wide — one
    // statement of the policy instead of two that could drift apart.
  });
  const meState = useQueryState(meQuery);

  // GAP-101/M-28: `QueryState`'s own idle/pending/error/ready split, applied
  // to the very first read in the app — its error branch is what matters
  // here: this used to be one of the two hand-rolled `isError` checks
  // anywhere in the client (the other was `CloseMonthScreen`'s). `idle` is
  // unreachable — this query carries no `enabled:`, so it folds into the
  // same fallback as `pending` rather than adding a branch nothing reaches.
  if (meState.kind === "error") {
    return (
      <div className="p-4">
        <QueryStateFailure error={meState.error} retry={meState.retry} of="your account" />
      </div>
    );
  }

  if (meState.kind !== "ready") {
    return <p className="p-4 text-body-sm text-ink-muted">Loading…</p>;
  }

  if (meState.data === null) {
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
            <CreateBusinessForm
              onCreated={(_business: BusinessResponse) => {
                void queryClient.invalidateQueries({ queryKey: ["me"] });
              }}
            />
          </Card>
          <Card className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 size-5 shrink-0 text-brand-ink" aria-hidden />
              <div>
                <h2 className="text-title text-ink-primary">Join a business</h2>
                <p className="text-body-sm text-ink-muted">Enter the code you were given.</p>
              </div>
            </div>
            <RedeemInviteForm
              onRedeemed={(_result: RedeemInviteResponse) => {
                void queryClient.invalidateQueries({ queryKey: ["me"] });
              }}
            />
          </Card>
        </div>
      </div>
    );
  }

  const { role } = meState.data;
  if (role === "owner_manager" || role === "manager") return <>{renderOperate()}</>;
  if (role === "owner") return <>{renderReview()}</>;
  return <>{renderMine()}</>;
}
