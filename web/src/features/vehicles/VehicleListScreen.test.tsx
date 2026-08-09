import { asBusinessDate } from "@fleetsettle/shared";
import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { VehicleListScreen } from "./VehicleListScreen.js";

const today = asBusinessDate("2026-07-30");

const vehicles: VehicleResponse[] = [
  { id: "v1", registration: "CAB-1234", vehicleType: "Bus", lifecycle: "active", arrangement: "B" },
  { id: "v2", registration: "CAR-5678", vehicleType: "Car", lifecycle: "active", arrangement: "A" },
];

test("lists every vehicle with its arrangement label", async () => {
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(<VehicleListScreen today={today} onSelectVehicle={vi.fn()} />, { get });

  expect(await screen.findByText("CAB-1234")).toBeInTheDocument();
  expect(screen.getByText("CAR-5678")).toBeInTheDocument();
  expect(screen.getByText("Daily lease")).toBeInTheDocument();
  expect(screen.getByText("Lease out")).toBeInTheDocument();
});

test("the arrangement label renders as a coloured Badge, not plain text (UI-LF-04)", async () => {
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(<VehicleListScreen today={today} onSelectVehicle={vi.fn()} />, { get });

  const badge = await screen.findByText("Daily lease");
  expect(badge.className).toContain("bg-good/15");
});

test("tapping a row reports that vehicle, not a route change", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  const onSelectVehicle = vi.fn();
  renderWithProviders(<VehicleListScreen today={today} onSelectVehicle={onSelectVehicle} />, {
    get,
  });

  await user.click(await screen.findByText("CAB-1234"));
  expect(onSelectVehicle).toHaveBeenCalledWith(vehicles[0]);
});

test("an empty fleet is a real, good state, not a blank screen", async () => {
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(<VehicleListScreen today={today} onSelectVehicle={vi.fn()} />, { get });

  expect(await screen.findByText("No vehicles yet.")).toBeInTheDocument();
});

test("Add a vehicle opens the create-vehicle sheet", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(<VehicleListScreen today={today} onSelectVehicle={vi.fn()} />, { get });

  await user.click(screen.getByRole("button", { name: "Add a vehicle" }));
  expect(screen.getByLabelText("Registration")).toBeInTheDocument();
});
