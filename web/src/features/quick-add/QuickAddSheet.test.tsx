import { asBusinessDate } from "@fleetsettle/shared";
import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { QuickAddSheet } from "./QuickAddSheet.js";

const today = asBusinessDate("2026-08-04");

const vehicles: VehicleResponse[] = [
  { id: "v1", registration: "NC-1234", vehicleType: "bus", lifecycle: "active", arrangement: "B" },
];

test("offers fuel, expense and new trip, fuel first — M-4's fixed order for what this phase ships", () => {
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(
    <QuickAddSheet open onOpenChange={() => {}} today={today} onBookTrip={vi.fn()} />,
    { get },
  );

  const buttons = screen.getAllByRole("button").map((b) => b.textContent);
  const fuelIndex = buttons.indexOf("Fuel");
  const expenseIndex = buttons.indexOf("Expense");
  const tripIndex = buttons.indexOf("New trip");
  expect(fuelIndex).toBeGreaterThanOrEqual(0);
  expect(fuelIndex).toBeLessThan(expenseIndex);
  expect(expenseIndex).toBeLessThan(tripIndex);
});

test("Fuel opens the fuel-fill sheet", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(
    <QuickAddSheet open onOpenChange={() => {}} today={today} onBookTrip={vi.fn()} />,
    { get },
  );

  await user.click(screen.getByRole("button", { name: "Fuel" }));
  expect(await screen.findByText("Log a fuel fill")).toBeInTheDocument();
});

test("Expense opens the record-expense sheet", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(
    <QuickAddSheet open onOpenChange={() => {}} today={today} onBookTrip={vi.fn()} />,
    { get },
  );

  await user.click(screen.getByRole("button", { name: "Expense" }));
  expect(await screen.findByRole("heading", { name: "Record expense" })).toBeInTheDocument();
});

test("New trip picks a vehicle, then reports it — no route change of its own (§3.1)", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  const onBookTrip = vi.fn();
  renderWithProviders(
    <QuickAddSheet open onOpenChange={() => {}} today={today} onBookTrip={onBookTrip} />,
    { get },
  );

  await user.click(screen.getByRole("button", { name: "New trip" }));
  await user.click(await screen.findByRole("button", { name: "NC-1234" }));

  expect(onBookTrip).toHaveBeenCalledWith("v1");
});

test("GAP-101: a failed vehicle-list read shows a notice in the New trip picker, never a silently empty list", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <QuickAddSheet open onOpenChange={() => {}} today={today} onBookTrip={vi.fn()} />,
    { get },
  );

  await user.click(screen.getByRole("button", { name: "New trip" }));

  expect(
    await screen.findByText("Something went wrong loading the vehicle list."),
  ).toBeInTheDocument();
});
