import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { VehicleOverviewScreen } from "./VehicleOverviewScreen.js";

test("renders the vehicle's fields once loaded", async () => {
  const get = vi.fn().mockResolvedValue({
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    arrangement: "B",
  } satisfies VehicleResponse);
  renderWithProviders(<VehicleOverviewScreen vehicleId="v1" onBack={() => {}} />, { get });

  expect(await screen.findByText("Bus")).toBeInTheDocument();
  expect(screen.getByText("Daily lease")).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/api/vehicle/v1");
});

test("no active arrangement renders NotAvailable, never a blank or a zero", async () => {
  const get = vi.fn().mockResolvedValue({
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
  } satisfies VehicleResponse);
  renderWithProviders(<VehicleOverviewScreen vehicleId="v1" onBack={() => {}} />, { get });

  expect(await screen.findByText("no active arrangement")).toBeInTheDocument();
});
