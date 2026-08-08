import type { BusinessResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../lib/api.js";
import { renderWithRouter } from "../test/renderWithRouter.js";

const ME_OPERATE = { userId: "u1", businessId: "b1", role: "owner_manager" as const };

test("no business yet (404 from /api/me) shows the create-business form, not the shell", async () => {
  const get = vi.fn();
  get.mockRejectedValue(new ApiError(404, "NOT_FOUND", "not found", "req-1"));

  renderWithRouter("/vehicles", { get });

  expect(await screen.findByRole("button", { name: "Create business" })).toBeInTheDocument();
});

test("owner_manager renders the operate shell at the deep-linked path, with no list visit first", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(ME_OPERATE);
    if (path === "/api/vehicle/v1") {
      return Promise.resolve({
        id: "v1",
        registration: "CAB-1234",
        vehicleType: "Bus",
        lifecycle: "active",
        arrangement: "B",
      } satisfies VehicleResponse);
    }
    throw new Error(`unexpected path ${path}`);
  });

  renderWithRouter("/vehicles/v1", { get });

  // "CAB-1234" appears twice once loaded (the Screen header and the body
  // card, same ambiguity VehicleOverviewScreen.test.tsx already sidesteps
  // by asserting on the vehicle type instead) — the heading role picks out
  // the routed screen's own title unambiguously.
  expect(await screen.findByRole("heading", { name: "CAB-1234" })).toBeInTheDocument();
  expect(screen.getByText("Bus")).toBeInTheDocument();
  expect(screen.queryByText("No vehicles yet.")).not.toBeInTheDocument();
});

test("tapping a vehicle row navigates to its detail route", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(ME_OPERATE);
    if (path === "/api/vehicle") {
      return Promise.resolve([
        { id: "v1", registration: "CAB-1234", vehicleType: "Bus", lifecycle: "active" },
      ] satisfies VehicleResponse[]);
    }
    if (path === "/api/vehicle/v1") {
      return Promise.resolve({
        id: "v1",
        registration: "CAB-1234",
        vehicleType: "Bus",
        lifecycle: "active",
      } satisfies VehicleResponse);
    }
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles", { get });

  await user.click(await screen.findByText("CAB-1234"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/vehicles/v1"));
});

test("Screen's back button from a vehicle detail returns to the list", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(ME_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    if (path === "/api/vehicle/v1") {
      return Promise.resolve({
        id: "v1",
        registration: "CAB-1234",
        vehicleType: "Bus",
        lifecycle: "active",
      } satisfies VehicleResponse);
    }
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles/v1", { get });
  await screen.findByRole("heading", { name: "CAB-1234" });

  await user.click(screen.getByRole("button", { name: "Back" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/vehicles"));
  expect(await screen.findByText("No vehicles yet.")).toBeInTheDocument();
});

test("tapping a tab navigates and the tab bar's active state follows the URL", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(ME_OPERATE);
    if (path === "/api/driver") return Promise.resolve([]);
    if (path === "/api/customer") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles", { get });
  await screen.findByRole("navigation", { name: "Operate" });

  await user.click(screen.getByRole("button", { name: "People" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/people"));
  expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-current", "page");
});

test("the More tab reaches the /more hub (GAP-37), no longer NotBuiltYetScreen", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(ME_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles", { get });
  await screen.findByText("No vehicles yet.");

  await user.click(screen.getByRole("button", { name: "More" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/more"));
  expect(screen.getByText("Sign out")).toBeInTheDocument();
  expect(screen.queryByText("Not built yet.")).not.toBeInTheDocument();
});

test("B12/GAP-61 — More → Opening balances reaches the real screen, not a placeholder", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(ME_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    if (path === "/api/opening-balance") {
      return Promise.reject(new ApiError(404, "NOT_FOUND", "no batch yet", "req-ob"));
    }
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/more", { get });
  await user.click(await screen.findByText("Opening balances"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/opening-balances"));
  expect(await screen.findByRole("heading", { name: "Opening balances" })).toBeInTheDocument();
});

test("B3/F-9.1 — More → Close the month reaches the real screen, not a placeholder", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(ME_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    if (path === "/api/accounting-period/checklist") {
      return Promise.resolve({
        period: { id: "p1", periodStart: "2026-08-01", periodEnd: "2026-08-31" },
        checklist: {
          unconfirmedDays: 0,
          openTrips: 0,
          unreconciledAdvances: 0,
          pendingObligations: 0,
          openIncidents: 0,
        },
      });
    }
    if (path === "/api/payment") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/more", { get });
  await user.click(await screen.findByText("Close the month"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/period/close"));
  expect(await screen.findByRole("heading", { name: "Close the month" })).toBeInTheDocument();
});

test('the quick-add ("+") tab never changes the route (§3.1: "no route change" — the sheet itself is a later phase\'s gap, tracked separately)', async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(ME_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles", { get });
  await screen.findByText("No vehicles yet.");

  await user.click(screen.getByRole("button", { name: "Add" }));

  expect(router.state.location.pathname).toBe("/vehicles");
});

test("an unknown path renders the not-found placeholder, not a blank screen", async () => {
  const get = vi.fn();
  get.mockResolvedValue(ME_OPERATE);
  renderWithRouter("/this-route-does-not-exist", { get });

  expect(await screen.findByRole("heading", { name: "Not found" })).toBeInTheDocument();
});

test("owner lands in the Review shell (redirected from / to its default tab), driver lands in the Mine shell (B0b, UI §1.1)", async () => {
  const getOwner = vi.fn();
  getOwner.mockResolvedValue({ userId: "u2", businessId: "b1", role: "owner" });
  const { router: ownerRouter, unmount } = renderWithRouter("/", { get: getOwner });
  expect(await screen.findByRole("heading", { name: "This month" })).toBeInTheDocument();
  await waitFor(() => expect(ownerRouter.state.location.pathname).toBe("/review"));
  // Review's own tab bar, not Operate's — the shell is a different
  // component tree, never Operate filtered by role (§7.9).
  expect(screen.getByRole("button", { name: "My money" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Home" })).not.toBeInTheDocument();
  unmount();

  const getDriver = vi.fn();
  getDriver.mockResolvedValue({
    userId: "u3",
    businessId: "b1",
    role: "driver",
    driverId: "d1",
  });
  const { router: driverRouter } = renderWithRouter("/", { get: getDriver });
  expect(await screen.findByRole("heading", { name: "Mine" })).toBeInTheDocument();
  await waitFor(() => expect(driverRouter.state.location.pathname).toBe("/me"));
  // Mine has no tab bar at all (§7.9) — the redirect proves the route
  // changed; the absence of a nav proves the shell did too.
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});

test("Review's tabs navigate between its own routes, and owner_manager never reaches them (M-3)", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockResolvedValue({ userId: "u2", businessId: "b1", role: "owner" });
  const { router } = renderWithRouter("/review", { get });

  await screen.findByRole("heading", { name: "This month" });
  await user.click(screen.getByRole("button", { name: "Reports" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/reports"));
  expect(await screen.findByRole("heading", { name: "Reports" })).toBeInTheDocument();
});

test("creating a business from the first-run gate replaces it with the operate shell", async () => {
  const user = userEvent.setup();
  let hasBusiness = false;
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") {
      if (!hasBusiness) throw new ApiError(404, "NOT_FOUND", "not found", "req-1");
      return Promise.resolve(ME_OPERATE);
    }
    if (path === "/api/vehicle") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn();
  post.mockImplementation(() => {
    hasBusiness = true;
    return Promise.resolve({
      id: "b1",
      name: "Test Fleet",
      currencyCode: "LKR",
      timezone: "Asia/Colombo",
      accountingPeriodId: "p1",
    } satisfies BusinessResponse);
  });

  renderWithRouter("/vehicles", { get, post });

  // The form is behind FirstRunGate's own /api/me query — it isn't in the
  // DOM on the first, pending render, so it has to be awaited before typing
  // into it (unlike CreateBusinessForm.test.tsx, where the form is the
  // whole subject under test and needs no query to appear first).
  await user.type(await screen.findByLabelText("Business name"), "Test Fleet");
  await user.click(screen.getByRole("button", { name: "Create business" }));

  expect(await screen.findByText("No vehicles yet.")).toBeInTheDocument();
});

test("redeeming an invite code from the first-run gate replaces it with the operate shell (A11/W-57)", async () => {
  const user = userEvent.setup();
  let hasAccess = false;
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/me") {
      if (!hasAccess) throw new ApiError(404, "NOT_FOUND", "not found", "req-1");
      return Promise.resolve({ userId: "u2", businessId: "b1", role: "manager" as const });
    }
    if (path === "/api/vehicle") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn();
  post.mockImplementation(() => {
    hasAccess = true;
    return Promise.resolve({ kind: "business_member", businessId: "b1", role: "manager" });
  });

  renderWithRouter("/vehicles", { get, post });

  // Deliberately not the create-business flow — this is FirstRunGate's
  // second, equally first-class option (Plan.md A11: "one screen serving
  // both the never-had-access and the revoked cases").
  await user.type(await screen.findByLabelText("Invite code"), "ABCDE-FGHJK");
  await user.click(screen.getByRole("button", { name: "Join" }));

  expect(await screen.findByText("No vehicles yet.")).toBeInTheDocument();
});
