import type { DriverBalancesResponse, DriverResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { DriverDetailScreen } from "./DriverDetailScreen.js";

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
    return Promise.resolve({
      driverId: "d1",
      owedToUsMinor: "0",
      owedByUsMinor: "0",
    } satisfies DriverBalancesResponse);
  });
  return get;
}

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
  await user.click(await screen.findByRole("button", { name: "Rs 0" }));
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
  await user.click(await screen.findByRole("button", { name: "Rs 0" }));
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
  await user.click(await screen.findByRole("button", { name: "Rs 0" }));
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
