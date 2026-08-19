import type { MeResponse, SessionResponse } from "@fleetsettle/shared/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { resolveSelectedMembership } from "./selectedMembership.js";

/**
 * B0b/UI §1.1, rebuilt onto `/api/session` (Phase 2, 18 Aug 2026): derives
 * the `MeResponse` shape every existing screen already expects from the
 * `["session"]` cache entry `FirstRunGate` populates — the *selected*
 * membership's `businessId`/`role`/`driverId` (`resolveSelectedMembership`,
 * Phase 3 — not `businesses[0]` unconditionally: a multi-membership user who
 * picked their second business must see that business's role here, not
 * whichever business happened to sort first), paired with the top-level
 * `userId`. Reading on demand, rather than `FirstRunGate` writing a separate
 * `["me"]` cache entry, is deliberate: it needs no `useEffect`/render-order
 * race against a child that calls `useMe()` in the very same render pass a
 * shell first mounts (`ReviewThisMonthScreen`, reached the instant the
 * Review shell renders, is exactly that child) — `["session"]` is
 * guaranteed populated by the time any shell renders at all, since
 * resolving it is what decides which shell to render.
 *
 * Safe to call unconditionally from anywhere inside
 * `renderOperate`/`renderReview`/`renderMine`: `FirstRunGate` never renders
 * those branches until a membership is definitely selected (single, or a
 * validated stored choice among several).
 */
export function useMe(): MeResponse {
  const queryClient = useQueryClient();
  const session = queryClient.getQueryData<SessionResponse>(["session"]);
  const membership = session !== undefined ? resolveSelectedMembership(session) : undefined;
  if (session === undefined || membership === undefined) {
    throw new Error("useMe() called before FirstRunGate resolved a role — is it nested wrong?");
  }
  return {
    userId: session.userId,
    businessId: membership.businessId,
    role: membership.role,
    ...(membership.driverId !== undefined ? { driverId: membership.driverId } : {}),
  };
}
