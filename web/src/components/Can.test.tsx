import type { MeRole, SessionResponse } from "@fleetsettle/shared/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Can } from "./Can.js";

/**
 * Phase 2 (18 Aug 2026): `Can` reads the `["session"]` cache (see
 * `useMe.ts`'s own note) rather than `["me"]` — synchronously, no observer,
 * so seeding it before the first render is enough.
 */
function renderAsRole(role: MeRole, ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<SessionResponse>(["session"], {
    userId: "u1",
    isPlatformAdmin: false,
    businesses: [{ businessId: "b1", name: "Test Fleet", role }],
    pendingRequest: null,
    hadMembership: true,
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

test("renders its children when the role holds the capability", () => {
  renderAsRole(
    "owner",
    <Can cap="closePeriod">
      <button type="button">Close July permanently</button>
    </Can>,
  );
  expect(screen.getByRole("button", { name: "Close July permanently" })).toBeInTheDocument();
});

test("renders nothing — absent, never disabled (M-22) — when the role lacks it", () => {
  renderAsRole(
    "manager",
    <Can cap="closePeriod">
      <button type="button">Close July permanently</button>
    </Can>,
  );
  expect(screen.queryByRole("button", { name: "Close July permanently" })).not.toBeInTheDocument();
});

test("a driver never sees a STAFF-only affordance", () => {
  renderAsRole(
    "driver",
    <Can cap="dailyOperations">
      <button type="button">Confirm today</button>
    </Can>,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
