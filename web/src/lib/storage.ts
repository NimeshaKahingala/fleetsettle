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
 */
export function getSelectedBusinessId(): string | null {
  return localStorage.getItem(SELECTED_BUSINESS_ID_KEY);
}

export function setSelectedBusinessId(id: string): void {
  localStorage.setItem(SELECTED_BUSINESS_ID_KEY, id);
}

/**
 * Decision 25 is specific about the one call site: `AuthActionsContext.tsx`'s
 * `signOut`, the one path both `auth-asgardeo.ts` and `auth-stub.ts` route
 * through — **never** `AuthGate.tsx`, which fires on every unauthenticated
 * render, including a transient token refresh, and would wipe the selection
 * out from under a live session.
 */
export function clearSelectedBusinessId(): void {
  localStorage.removeItem(SELECTED_BUSINESS_ID_KEY);
}
