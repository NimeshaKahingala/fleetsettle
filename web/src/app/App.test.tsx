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

test("owner renders the Review placeholder, driver renders the Mine placeholder (UI §1.1)", async () => {
  const getOwner = vi.fn();
  getOwner.mockResolvedValue({ userId: "u2", businessId: "b1", role: "owner" });
  const { unmount } = renderWithRouter("/", { get: getOwner });
  expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
  unmount();

  const getDriver = vi.fn();
  getDriver.mockResolvedValue({
    userId: "u3",
    businessId: "b1",
    role: "driver",
    driverId: "d1",
  });
  renderWithRouter("/", { get: getDriver });
  expect(await screen.findByRole("heading", { name: "Mine" })).toBeInTheDocument();
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
