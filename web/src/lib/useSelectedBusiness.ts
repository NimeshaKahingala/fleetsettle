import type { SessionResponse } from "@fleetsettle/shared/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { resolveSelectedMembership } from "./selectedMembership.js";

export interface SelectedBusiness {
  name: string;
  businesses: SessionResponse["businesses"];
}

/**
 * UI §3.1/M-33 (18 Aug 2026 decision, built 19 Aug): `AppShell`'s app-bar
 * business name and its switcher affordance need the same two facts every
 * screen does — which business is selected, and how many the identity
 * actually holds — read from the same `["session"]` cache `useMe()` already
 * reads, via the same `resolveSelectedMembership` `useMe()`/`<Can>` use, so
 * this can never disagree with what `useMe()`'s own `businessId` names.
 *
 * Same unconditional-call guarantee as `useMe()`: safe from anywhere inside
 * `renderOperate`/`renderReview`/`renderMine` — `FirstRunGate` never
 * renders those branches until a membership is definitely selected. Never
 * called from `renderAdmin`: the admin surface has no business selected,
 * `AppShell`'s `businessName` prop stays `undefined` there by construction
 * rather than by a guard here.
 */
export function useSelectedBusiness(): SelectedBusiness {
  const queryClient = useQueryClient();
  const session = queryClient.getQueryData<SessionResponse>(["session"]);
  const membership = session !== undefined ? resolveSelectedMembership(session) : undefined;
  if (session === undefined || membership === undefined) {
    throw new Error(
      "useSelectedBusiness() called before FirstRunGate resolved a role — is it nested wrong?",
    );
  }
  return { name: membership.name, businesses: session.businesses };
}
