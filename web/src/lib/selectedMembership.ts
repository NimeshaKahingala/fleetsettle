import type { SessionMembership, SessionResponse } from "@fleetsettle/shared/schemas";
import { getSelectedBusinessId } from "./storage.js";

/**
 * The one membership `FirstRunGate` committed to for this session: the
 * stored selection, if it still names one of the caller's current
 * `businesses`, else the sole membership when there is only one.
 *
 * Every reader downstream of `FirstRunGate`'s shell dispatch — `useMe()`,
 * `Can`, `ReportsCatalogueScreen` — must resolve the *same* membership
 * `FirstRunGate` rendered a shell for, not just `businesses[0]`. Before the
 * switcher, those three read `businesses[0]` directly (correct, since there
 * was never more than one row); left alone, a multi-membership user who
 * picks their second business would still see the first business's role
 * everywhere `<Can>` and `useMe()` gate something — the switch would be
 * cosmetic. `FirstRunGate` itself never renders a shell at all unless a
 * selection is already valid (see its own doc comment), so by the time any
 * of these three run, `businesses` is guaranteed to contain the selected
 * id — the `?? businesses[0]` fallback below is defence in depth for a
 * state that should never actually arise, matching the optional-chaining
 * style these three call sites already used before this existed.
 */
export function resolveSelectedMembership(session: SessionResponse): SessionMembership | undefined {
  const selectedId = getSelectedBusinessId();
  if (selectedId !== null) {
    const matched = session.businesses.find((b) => b.businessId === selectedId);
    if (matched !== undefined) return matched;
  }
  return session.businesses[0];
}
