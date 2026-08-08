import type { MeResponse } from "@fleetsettle/shared/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Can } from "./Can.js";

/**
 * `useMe()` reads the `["me"]` cache synchronously (no observer, no
 * refetch) — seeding it before the first render is enough; `Can` never
 * needs `ApiProvider`/`AuthActionsProvider`, so this stays a local helper
 * rather than pulling in the full `renderWithProviders` stack.
 */
function renderAsRole(role: MeResponse["role"], ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<MeResponse>(["me"], {
    userId: "u1",
    businessId: "b1",
    role,
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
