import type { TokenGetter } from "./api.js";

/**
 * A stand-in for the real Asgardeo token getter, so screens can be built
 * and tested without the PKCE login round trip. Real wiring is still
 * blocked on console changes (TRACKER P1); this is the seam that keeps that
 * from blocking every screen behind it.
 *
 * **This does not make the API accept anything.** The token below is not
 * signed by anything and will never pass `verifyAccessToken`'s JWKS check —
 * a real Worker returns 401 for it, exactly as it should. What it buys is
 * that the request is actually *issued* rather than throwing in the client
 * first, which is what lets Playwright's `page.route()` intercept it and
 * what lets `npm run dev` render real screens against a mocked API. Wiring
 * a local API that accepts a dev token is a separate, deliberately
 * deferred piece of the same TRACKER item.
 *
 * Opt-in is an explicit `VITE_AUTH_MODE=stub`, never `import.meta.env.DEV`:
 * the e2e suite runs against a real production build (`vite build` +
 * `preview`), where `DEV` is false, so a DEV gate would silently not apply
 * there — and a gate that behaves differently under test than the thing it
 * gates is worse than no gate. A real deployment simply never sets the
 * variable.
 *
 * What that compiles to, checked against a real build rather than assumed:
 * with the variable unset, Vite emits `import.meta.env` as an empty object
 * literal, so `isStubAuthEnabled()` becomes a constant-false comparison
 * against a value nothing at runtime can influence — no `window`, no query
 * param, no storage. The branch is therefore *unreachable* in production,
 * but it is **not tree-shaken**: `STUB_TOKEN`'s text does still appear in
 * the shipped bundle. That is inert (an unsigned string that no verifier
 * accepts is not a credential), but it is worth knowing before someone
 * greps a production bundle, finds the word "token", and files a security
 * bug against it.
 */
export const STUB_AUTH_MODE = "stub";

/** Obviously-fake, unsigned, and labelled as such — so a token that leaks into a log or a bug report reads as a stub at a glance rather than looking like a real credential to be revoked. */
const STUB_TOKEN = "stub-token.not-a-real-jwt.asgardeo-not-wired-yet";

export function isStubAuthEnabled(): boolean {
  return (import.meta.env["VITE_AUTH_MODE"] as string | undefined) === STUB_AUTH_MODE;
}

export function createStubTokenGetter(): TokenGetter {
  return () => Promise.resolve(STUB_TOKEN);
}

/**
 * The honest failure when nothing is wired: throws at the moment a request
 * is actually attempted, with a message that names the blocker, rather than
 * resolving `undefined` and producing an opaque 401 later.
 */
export function createUnwiredTokenGetter(): TokenGetter {
  return () => {
    throw new Error("Asgardeo is not wired yet — see TRACKER.md P1 (blocked on console changes).");
  };
}
