import type { AuthReactConfig } from "@asgardeo/auth-react";
import type { TokenGetter } from "./api.js";

/**
 * The one path Asgardeo redirects back to, and it must match the redirect
 * URL registered on the app in the console **exactly** — a mismatch is
 * refused by Asgardeo before our code runs at all, with an error page rather
 * than a callback, which is why this is a constant rather than three strings
 * that could drift apart.
 *
 * Registered today: `http://localhost:5173/auth/callback` (local dev),
 * `https://qa.fleetsettle.com/auth/callback`, `https://fleetsettle.com/auth/callback`.
 */
export const AUTH_CALLBACK_PATH = "/auth/callback";

function requireEnv(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set. The client's OAuth config is inlined at build time — ` +
        `check web/.env.<mode> and that the build ran with the right --mode.`,
    );
  }
  return value;
}

/**
 * §12.1 / TS §1. PKCE is on by default for a public client and stays on: the
 * client id below is inlined into the bundle and is public by design, so the
 * proof-of-possession half of the exchange is the only thing standing between
 * an intercepted authorization code and a usable token.
 *
 * `origin` is passed in rather than read from `window` so this is testable and
 * so the redirect URL is always the origin actually being served — local dev,
 * QA and production each register their own, and deriving it removes the third
 * place a hostname could be typed wrong.
 */
export function asgardeoConfig(origin: string): AuthReactConfig {
  return {
    signInRedirectURL: `${origin}${AUTH_CALLBACK_PATH}`,
    signOutRedirectURL: origin,
    clientID: requireEnv("VITE_ASGARDEO_CLIENT_ID"),
    baseUrl: requireEnv("VITE_ASGARDEO_BASE_URL"),
    // Matches the app's registered scope. `openid` is what makes this OIDC
    // rather than bare OAuth, and `sub` — the claim the Worker resolves the
    // business from — rides on it.
    scope: ["openid", "profile"],
    enablePKCE: true,
  };
}

/**
 * The bridge between the SDK (a React hook) and the API client (built once, at
 * module scope, before React mounts — see `main.tsx`).
 *
 * §12.1 requires the token getter be *injected* into `createApiClient` so the
 * API layer never imports the auth SDK. That contract is what let every screen
 * be built and tested against the stub, and it is worth keeping — so rather
 * than restructure the composition root around a hook, the getter closes over
 * a slot that `AuthGate` fills on mount.
 *
 * **It deliberately does not cache the token.** Every request asks the SDK
 * again, so a token refreshed in the background is picked up on the very next
 * call. M-12's replay queue needs exactly that — a paused mutation replayed an
 * hour later must not present the token it was queued with.
 */
let tokenSource: (() => Promise<string>) | null = null;

export function registerAsgardeoTokenSource(getAccessToken: () => Promise<string>): void {
  tokenSource = getAccessToken;
}

/** Test seam — the slot is module state, so a test that registers must be able to clear it. */
export function clearAsgardeoTokenSource(): void {
  tokenSource = null;
}

export function createAsgardeoTokenGetter(): TokenGetter {
  return async () => {
    if (!tokenSource) {
      throw new Error(
        "The Asgardeo token source is not registered yet — a request was issued " +
          "before AuthGate mounted. Screens must not fetch outside the gate.",
      );
    }
    return tokenSource();
  };
}
