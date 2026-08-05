import { businessToday } from "@fleetsettle/shared";
import { QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { createAppRouteTree } from "./app/router.js";
import { createApiClient } from "./lib/api.js";
import {
  createStubTokenGetter,
  createUnwiredTokenGetter,
  isStubAuthEnabled,
} from "./lib/auth-stub.js";
import "./design/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

const apiBaseUrl = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

// §12.1: "the token getter is injected rather than imported, so the API
// layer never depends on the auth SDK directly" — which is what makes
// swapping the stub for the real Asgardeo getter a one-line change here,
// touching nothing else.
const getToken = isStubAuthEnabled() ? createStubTokenGetter() : createUnwiredTokenGetter();

const queryClient = new QueryClient();
const apiClient = createApiClient(apiBaseUrl, getToken);
const router = createAppRouteTree(businessToday());

createRoot(root).render(
  <StrictMode>
    <App router={router} queryClient={queryClient} apiClient={apiClient} />
  </StrictMode>,
);
