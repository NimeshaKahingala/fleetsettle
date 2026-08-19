import { AuthProvider } from "@asgardeo/auth-react";
import { businessToday } from "@fleetsettle/shared";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { AuthGate } from "./app/AuthGate.js";
import { createAppRouteTree } from "./app/router.js";
import { ApiError, createApiClient } from "./lib/api.js";
import {
  asgardeoConfig,
  createAsgardeoSignOutGetter,
  createAsgardeoTokenGetter,
} from "./lib/auth-asgardeo.js";
import { createStubSignOut, createStubTokenGetter, isStubAuthEnabled } from "./lib/auth-stub.js";
import { shouldRetryQuery } from "./lib/queryRetry.js";
import { clearSelectedBusinessId, getSelectedBusinessId } from "./lib/storage.js";
import "./design/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

const apiBaseUrl = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

// §12.1: "the token getter is injected rather than imported, so the API
// layer never depends on the auth SDK directly" — which is what made
// swapping the stub for the real Asgardeo getter a change to this file
// alone, touching no screen and no query.
const stubbed = isStubAuthEnabled();
const getToken = stubbed ? createStubTokenGetter() : createAsgardeoTokenGetter();
const signOut = stubbed ? createStubSignOut() : createAsgardeoSignOutGetter();

// A11: a role change never invalidates a token — resolveMembership runs per
// request (api/src/queries/identity.ts), so the server side of a demotion is
// already live on the next call. The client's own stale copy of "what can I
// do" is `["me"]`'s cached role, and nothing refetches it on its own; without
// this, a demoted user keeps seeing affordances they can no longer use until
// they happen to reload. One handler here covers every screen, rather than
// each mutation remembering to invalidate ["me"] on its own 403.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      }
      // IG §7.5 step 4b / decision 9: the server refuses to guess between
      // more than one membership when the client sends no header — this
      // should be rare (the client sends one whenever a selection exists),
      // but can happen, e.g. a stored selection that raced a revocation.
      // The stored choice is no longer trustworthy, so drop it and let
      // FirstRunGate re-resolve — its own re-render is what gives the
      // switcher a reason to open, never an error screen.
      if (err instanceof ApiError && err.code === "BUSINESS_NOT_SELECTED") {
        clearSelectedBusinessId();
        void queryClient.invalidateQueries({ queryKey: ["session"] });
      }
    },
  }),
  // GAP-101/UI §9.5: a 4xx is a decided answer, not a hiccup — without this,
  // QueryState's error branch sits behind ~7s of the default 3-attempt
  // backoff before isError ever turns true, on every read in the client.
  defaultOptions: { queries: { retry: shouldRetryQuery } },
});
const apiClient = createApiClient(apiBaseUrl, getToken, getSelectedBusinessId);
const router = createAppRouteTree(businessToday());
const app = (
  <App router={router} queryClient={queryClient} apiClient={apiClient} signOut={signOut} />
);

// The stub path renders no AuthProvider at all, rather than an AuthProvider in
// a disabled mode: `npm run dev` and the e2e suite must not reach Asgardeo, and
// the surest way to guarantee that is for the SDK to have no instance to reach
// it with. `isStubAuthEnabled` is an explicit VITE_AUTH_MODE=stub and never
// `import.meta.env.DEV` — auth-stub.ts records why.
createRoot(root).render(
  <StrictMode>
    {stubbed ? (
      app
    ) : (
      <AuthProvider config={asgardeoConfig(window.location.origin)}>
        <AuthGate>{app}</AuthGate>
      </AuthProvider>
    )}
  </StrictMode>,
);
