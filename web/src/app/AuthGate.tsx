import { useAuthContext } from "@asgardeo/auth-react";
import { useEffect, useRef } from "react";
import { Button } from "../design/primitives/Button.js";
import { Screen } from "../design/primitives/Screen.js";
import { AUTH_CALLBACK_PATH, registerAsgardeoTokenSource } from "../lib/auth-asgardeo.js";

/** Asgardeo's redirect lands here; nothing else in §3.3's route map does. */
function isOnCallbackPath(location: Location): boolean {
  return location.pathname === AUTH_CALLBACK_PATH;
}

/**
 * Whether this page load is Asgardeo handing us back an authorization code.
 * Checked against the path *and* the query, because the code is single-use:
 * running the exchange twice fails the second time, and React 19's StrictMode
 * mounts every effect twice in development.
 */
function isCallbackReturn(location: Location): boolean {
  return isOnCallbackPath(location) && new URLSearchParams(location.search).has("code");
}

export interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Everything behind this is authenticated. It does three things and nothing
 * else — it is not a screen with logic of its own:
 *
 * 1. Registers the SDK's `getAccessToken` as the API client's token source
 *    (see `auth-asgardeo.ts` for why that is a slot rather than a hook).
 * 2. Completes the authorization-code exchange when Asgardeo redirects back.
 * 3. Offers sign-in when there is no session, and blocks until there is one.
 *
 * **It deliberately does not sign the user in automatically.** A silent
 * redirect to an identity provider on first paint is indistinguishable from a
 * broken app if it fails, and this product is opened by two people who already
 * know what it is — one tap is clearer than a redirect they did not ask for.
 */
export function AuthGate({ children }: AuthGateProps) {
  // Held as one object and called through, never destructured: these are
  // methods on the SDK's context, and pulling them off it detaches them from
  // their `this`. The ref keeps the effects below from re-running every time
  // the SDK hands back a new context identity.
  const auth = useAuthContext();
  const { state } = auth;
  const authRef = useRef(auth);
  authRef.current = auth;
  const exchangeStarted = useRef(false);

  useEffect(() => {
    // Registered once. It resolves through the ref on every call, so it always
    // asks the *current* context — which is what keeps a background-refreshed
    // token reaching the next request (M-12).
    registerAsgardeoTokenSource(() => authRef.current.getAccessToken());
  }, []);

  useEffect(() => {
    if (!isOnCallbackPath(window.location)) return;

    // Already signed in and still sitting on the callback path — a refresh, a
    // back button, or a second tab. Leave, rather than let the router render
    // a 404 for a path that is not in §3.3's map.
    if (state.isAuthenticated) {
      window.location.replace("/");
      return;
    }

    // The authorization code is single-use, and StrictMode runs this twice in
    // development — the ref, not the state flag, is what makes the second run
    // a no-op, because state has not updated by the time it fires.
    if (exchangeStarted.current) return;
    if (!isCallbackReturn(window.location)) return;

    exchangeStarted.current = true;
    void authRef.current.signIn().then(() => {
      // A real navigation, not `history.replaceState`. The router is built once
      // at module scope (main.tsx) over browser history, so rewriting the URL
      // underneath it would leave it resolving the callback path it captured at
      // creation. Reloading at the root costs one paint, once per sign-in, and
      // the session it just established is in storage — so this returns
      // straight to an authenticated app rather than round-tripping Asgardeo
      // again. It also drops `?code=…` so a refresh cannot replay a spent code.
      window.location.replace("/");
    });
  }, [state.isAuthenticated]);

  if (state.isLoading || isOnCallbackPath(window.location)) {
    return (
      <Screen title="FleetSettle">
        <p className="text-body text-ink-secondary">Signing you in…</p>
      </Screen>
    );
  }

  if (!state.isAuthenticated) {
    return (
      <Screen title="FleetSettle">
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink-secondary">Sign in to continue.</p>
          <Button size="cta" onClick={() => void authRef.current.signIn()}>
            Sign in
          </Button>
        </div>
      </Screen>
    );
  }

  return <>{children}</>;
}
