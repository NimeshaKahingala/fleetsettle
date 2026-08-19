/**
 * Decision 25 (PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md §2):
 * the first use of `localStorage` anywhere in `web/src` (confirmed by grep —
 * zero existing call sites before this file), so there was no convention to
 * inherit — this establishes the dot-namespace convention for any key that
 * follows it.
 */
export const SELECTED_BUSINESS_ID_KEY = "fleetsettle.selectedBusinessId";

/**
 * `localStorage.getItem` itself *is* the read — never cache the value in a
 * module-level variable. This is the function passed as `api.ts`'s
 * `BusinessIdGetter`, and it must see a same-tick change (e.g. right after
 * `setSelectedBusinessId` in the switcher's own select handler) exactly the
 * same way `TokenGetter` is read fresh on every request.
 *
 * **Fixes a review finding on PR #76 (gitar-bot)**: `localStorage` throws a
 * `SecurityError` in a storage-blocked environment (historically Safari
 * private mode; any "block all cookies/site data" setting) — and this
 * getter runs synchronously inside `request()`/`requestBlob()` on *every*
 * API call, so an unguarded throw here would have failed every request in
 * such an environment, not just the switcher. The selection is best-effort,
 * never load-bearing (a business with one membership sends no header either
 * way; a multi-membership user just gets asked again) — degrading to "no
 * stored selection" is always safe, an app-wide outage never is.
 */
export function getSelectedBusinessId(): string | null {
  try {
    return localStorage.getItem(SELECTED_BUSINESS_ID_KEY);
  } catch {
    return null;
  }
}

export function setSelectedBusinessId(id: string): void {
  try {
    localStorage.setItem(SELECTED_BUSINESS_ID_KEY, id);
  } catch {
    // Storage unavailable — the switcher's own selection is best-effort;
    // see the getter's own comment for why a throw here must not propagate.
  }
}

/**
 * Decision 25 is specific about the one call site: `AuthActionsContext.tsx`'s
 * `signOut`, the one path both `auth-asgardeo.ts` and `auth-stub.ts` route
 * through — **never** `AuthGate.tsx`, which fires on every unauthenticated
 * render, including a transient token refresh, and would wipe the selection
 * out from under a live session.
 */
export function clearSelectedBusinessId(): void {
  try {
    localStorage.removeItem(SELECTED_BUSINESS_ID_KEY);
  } catch {
    // Nothing to clean up if storage was never reachable in the first place.
  }
}
