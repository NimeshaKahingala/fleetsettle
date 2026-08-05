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

  // "Sunil Perera" appears twice once loaded — Screen's own <h1> title and
  // TwoBalances' own <h2> — the same header/body duplication every screen
  // showing a record's name in both places already has (VehicleOverviewScreen's
  // "CAB-1234" being the first instance of it).
  expect(await screen.findAllByText("Sunil Perera")).toHaveLength(2);
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
