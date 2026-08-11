import type {
  DriverBalancesResponse,
  DriverResponse,
  DriverViewResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { DriverDetailScreen } from "./DriverDetailScreen.js";

const emptyHistory: DriverViewResponse = {
  owedToUsMinor: "0",
  owedByUsMinor: "0",
  days: [],
  trips: [],
  advances: [],
  offsets: [],
  deposit: null,
};

function isDriverHistoryPath(path: string): boolean {
  return path.startsWith("/api/driver/d1/view?");
}

test("renders the driver's name and both balances, never a signed net (W-2)", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "800000",
        owedByUsMinor: "1200000",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    throw new Error(`unexpected path ${path}`);
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  // GAP-78: "Sunil Perera" appears once — Screen's own title, not repeated
  // as a bare unlabeled heading inside TwoBalances too. Distinct from
  // VehicleOverviewScreen's "Registration: CAB-1234" field, which is a
  // labeled data row alongside Type/Arrangement, not a duplicate heading.
  expect(await screen.findAllByText("Sunil Perera")).toHaveLength(1);
  expect(screen.getByText("He owes you")).toBeInTheDocument();
  expect(screen.getByText("Rs 8,000")).toBeInTheDocument();
  expect(screen.getByText("You owe him")).toBeInTheDocument();
  expect(screen.getByText("Rs 12,000")).toBeInTheDocument();
  expect(screen.getByText("Net: you owe him")).toBeInTheDocument();
});

test("GAP-101: a failed balances read shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    throw new Error(`unexpected path ${path}`);
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading this driver's balances."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});

test("Offset opens the offset sheet", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    return Promise.resolve({
      driverId: "d1",
      owedToUsMinor: "0",
      owedByUsMinor: "0",
    } satisfies DriverBalancesResponse);
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  await user.click(await screen.findByRole("button", { name: "Offset…" }));

  expect(await screen.findByText("Offset")).toBeInTheDocument();
});

function baseGet() {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    throw new Error(`unexpected path ${path}`);
  });
  return get;
}

test("A5: staff driver detail shows recent days, trips, advances, offsets and deposit", async () => {
  const history: DriverViewResponse = {
    owedToUsMinor: "200000",
    owedByUsMinor: "900000",
    days: [
      {
        businessDate: "2026-08-10",
        state: "paused_for_trip",
        earnedMinor: "0",
        receivedMinor: "0",
        lostReason: null,
      },
    ],
    trips: [
      {
        id: "t1",
        vehicleId: "v1",
        closingDate: "2026-08-09",
        agreedAmountMinor: "3000000",
        driverFeeMinor: "500000",
      },
    ],
    advances: [{ id: "a1", amountMinor: "100000", issuedOn: "2026-08-03", status: "open" }],
    offsets: [{ id: "o1", amountMinor: "50000", occurredOn: "2026-08-05" }],
    deposit: { id: "dep1", heldMinor: "250000" },
  };
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "200000",
        owedByUsMinor: "900000",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(history);
    throw new Error(`unexpected path ${path}`);
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Recent days · 1")).toBeInTheDocument();
  expect(screen.getByText("Excused for trip")).toBeInTheDocument();
  expect(screen.getByText("Trips and fees · 1")).toBeInTheDocument();
  expect(screen.getByText("Driver fee")).toBeInTheDocument();
  expect(screen.getByText("Advances · 1")).toBeInTheDocument();
  expect(screen.getByText("Offsets · 1")).toBeInTheDocument();
  expect(screen.getByText("Held deposit")).toBeInTheDocument();
});

/** GAP-63/64/66 (B13) — the three actions found by the 8 Aug flow-inventory audit, each a write endpoint that existed with no caller until now. */
test("Driver money opens the action sheet with all three new actions", async () => {
  const user = userEvent.setup();
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get: baseGet() });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));

  expect(await screen.findByText("Pay the driver")).toBeInTheDocument();
  expect(screen.getByText("Record an advance")).toBeInTheDocument();
  expect(screen.getByText("Record a deposit")).toBeInTheDocument();
});

test("GAP-63 — Pay the driver posts a 'paid'-direction payment", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "p1" });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));
  await user.click(await screen.findByText("Pay the driver"));
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "50000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Pay driver" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/payment",
      expect.objectContaining({ direction: "paid", partyType: "driver", partyId: "d1" }),
    ),
  );
});

test("GAP-64 — Record an advance posts to /api/advance", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "a1" });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));
  await user.click(await screen.findByText("Record an advance"));
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "10000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Record advance" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/advance",
      expect.objectContaining({ driverId: "d1", amountMinor: "10000" }),
    ),
  );
});

test("GAP-66 — Record a deposit posts to /api/deposit", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "dep1" });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));
  await user.click(await screen.findByText("Record a deposit"));
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "25000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Record deposit" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/deposit",
      expect.objectContaining({ driverId: "d1", amountMinor: "25000" }),
    ),
  );
});

test("F-1.8: Driver access creates a link invite code", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    code: "DRV-123",
    expiresAt: "2026-08-12T00:00:00.000Z",
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, {
    get: baseGet(),
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Driver access" }));
  await user.click(await screen.findByRole("button", { name: "Create account link" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/driver/d1/link-invite", {}));
  expect(await screen.findByText("DRV-123")).toBeInTheDocument();
});

test("F-1.8: Driver access unlinks after confirmation", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  } satisfies DriverResponse);
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, {
    get: baseGet(),
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Driver access" }));
  await user.click(await screen.findByRole("button", { name: "Unlink account" }));
  await user.click(await screen.findByRole("button", { name: "Unlink account" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/driver/d1/unlink", {}));
});
