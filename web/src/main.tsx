import { AuthProvider } from "@asgardeo/auth-react";
import { businessToday } from "@fleetsettle/shared";
import { QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { AuthGate } from "./app/AuthGate.js";
import { createAppRouteTree } from "./app/router.js";
import { createApiClient } from "./lib/api.js";
import { asgardeoConfig, createAsgardeoTokenGetter } from "./lib/auth-asgardeo.js";
import { createStubTokenGetter, isStubAuthEnabled } from "./lib/auth-stub.js";
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

const queryClient = new QueryClient();
const apiClient = createApiClient(apiBaseUrl, getToken);
const router = createAppRouteTree(businessToday());
const app = <App router={router} queryClient={queryClient} apiClient={apiClient} />;

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
