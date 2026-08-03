import { businessToday } from "@fleetsettle/shared";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { App } from "../app/App.js";
import { createAppRouteTree } from "../app/router.js";
import type { ApiClient } from "../lib/api.js";

/**
 * The `App`-level counterpart to `renderWithProviders`: builds an isolated
 * router over `createMemoryHistory` (no jsdom URL mutation, one history per
 * test) instead of rendering the real `main.tsx` singleton, and returns the
 * router itself so a test can assert *where it navigated to*
 * (`router.state.location.pathname`), not just what rendered — the thing a
 * memory history makes possible that a rendered-in-isolation screen test
 * cannot show.
 */
export function renderWithRouter(initialPath: string, api: Partial<ApiClient> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createAppRouteTree(businessToday(), history);

  const result = render(
    <App router={router} queryClient={queryClient} apiClient={api as ApiClient} />,
  );

  return { ...result, router };
}
