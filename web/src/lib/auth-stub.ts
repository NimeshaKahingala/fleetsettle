import type { TokenGetter } from "./api.js";

/**
 * A stand-in for the real Asgardeo token getter, so screens can be built and
 * tested without the PKCE login round trip. **Real auth is wired now** (B8,
 * `lib/auth-asgardeo.ts`); this stays because `npm run dev` and the e2e suite
 * still need to run without reaching an identity provider.
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
const STUB_TOKEN = "stub-token.not-a-real-jwt.for-local-dev-and-e2e-only";

export function isStubAuthEnabled(): boolean {
  return (import.meta.env["VITE_AUTH_MODE"] as string | undefined) === STUB_AUTH_MODE;
}

export function createStubTokenGetter(): TokenGetter {
  return () => Promise.resolve(STUB_TOKEN);
}

/**
 * Stub mode never mounts `AuthGate`, so there is no session to end and
 * nowhere to redirect to — the app renders unconditionally either way. This
 * exists so B0's sign-out row still has something to call in `npm run dev`
 * and the e2e suite; the query-cache clear it triggers (`useAuthActions`,
 * the composition-root layer above this) is the part actually worth
 * exercising there.
 */
export function createStubSignOut(): () => Promise<void> {
  return () => Promise.resolve();
}

// `createUnwiredTokenGetter` lived here until Asgardeo was wired (B8). Its job
// was to fail loudly at the first request instead of producing an opaque 401,
// and it is gone rather than kept "just in case": the real getter
// (lib/auth-asgardeo.ts) now occupies that branch, and a second placeholder
// path would be one more thing that could be selected by mistake.
