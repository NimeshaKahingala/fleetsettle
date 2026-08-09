import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { businessToday } from "@fleetsettle/shared";
import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ApiClient } from "../lib/api.js";
import { App } from "./App.js";
import { createAppRouteTree } from "./router.js";

const ME_OPERATE = { userId: "u1", businessId: "b1", role: "owner_manager" as const };

/**
 * `useMobileHistoryDismiss` (`Sheet`'s mobile back-button support) calls
 * `window.history.pushState`/`.back()` directly, and TanStack Router's
 * default (browser) history wraps that same `window.history` — unlike
 * every other test here, which uses `createMemoryHistory` and so never
 * touches the real jsdom history/location at all. This is the one place
 * the two can actually interact, so it gets its own file with a real
 * browser-backed router rather than sharing `renderWithRouter`'s memory
 * history, and its own careful jsdom URL reset so it can't leak into
 * other test files' assumptions about the starting location.
 */
function mockCoarsePointer(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as typeof window.matchMedia;
}

beforeEach(() => {
  mockCoarsePointer(true);
  window.history.replaceState(null, "", "/vehicles");
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

test("opening and dismissing a sheet (via its visible close button) on a routed screen leaves the route unchanged", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(ME_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    throw new Error(`unexpected path ${path}`);
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // No `history` override — the real point of this test is the default
  // browser history, the one `useMobileHistoryDismiss` can actually collide
  // with; `window.history` already sits on `/vehicles` from `beforeEach`.
  const router = createAppRouteTree(businessToday());

  const apiClient: Partial<ApiClient> = { get };
  render(
    <App
      router={router}
      queryClient={queryClient}
      apiClient={apiClient as ApiClient}
      signOut={() => Promise.resolve()}
    />,
  );

  await screen.findByText("No vehicles yet.");
  expect(router.state.location.pathname).toBe("/vehicles");

  await user.click(screen.getByRole("button", { name: "Add a vehicle" }));
  expect(await screen.findByLabelText("Registration")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Close" }));

  expect(screen.queryByLabelText("Registration")).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/vehicles");
  expect(await screen.findByText("No vehicles yet.")).toBeInTheDocument();
});
