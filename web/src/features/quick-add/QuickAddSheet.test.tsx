import { asBusinessDate } from "@fleetsettle/shared";
import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { __resetSheetHistoryStackForTests } from "../../lib/useMobileHistoryDismiss.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { QuickAddSheet } from "./QuickAddSheet.js";

const today = asBusinessDate("2026-08-04");

const vehicles: VehicleResponse[] = [
  { id: "v1", registration: "NC-1234", vehicleType: "bus", lifecycle: "active", arrangement: "B" },
];

function mockCoarsePointer(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as typeof window.matchMedia;
}

beforeEach(() => {
  mockCoarsePointer(true);
  __resetSheetHistoryStackForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * GAP-104: a `vi.fn()` no-op `onOpenChange` never actually closes the sheet
 * `ActionSheet` calls it on, so it can't reproduce the mobile handoff race
 * (`ActionSheet` closes itself and opens the target sheet in one handler —
 * the target-closes-itself bug only shows up when the parent's `open` prop
 * really does flip false in the same commit). A real `useState`-backed
 * `onOpenChange`, on a real touch device (`mockCoarsePointer` above), is
 * what actually exercises it — every test below renders through this,
 * not a no-op.
 */
function QuickAddSheetHarness({
  onBookTrip = vi.fn(),
}: {
  onBookTrip?: (vehicleId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return <QuickAddSheet open={open} onOpenChange={setOpen} today={today} onBookTrip={onBookTrip} />;
}

test("offers fuel, expense and new trip, fuel first — M-4's fixed order for what this phase ships", () => {
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(<QuickAddSheetHarness />, { get });

  const buttons = screen.getAllByRole("button").map((b) => b.textContent);
  const fuelIndex = buttons.indexOf("Fuel");
  const expenseIndex = buttons.indexOf("Expense");
  const tripIndex = buttons.indexOf("New trip");
  expect(fuelIndex).toBeGreaterThanOrEqual(0);
  expect(fuelIndex).toBeLessThan(expenseIndex);
  expect(expenseIndex).toBeLessThan(tripIndex);
});

test("Fuel opens the fuel-fill sheet, and it stays open on a touch device (GAP-104)", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(<QuickAddSheetHarness />, { get });

  await user.click(screen.getByRole("button", { name: "Fuel" }));
  expect(await screen.findByText("Log a fuel fill")).toBeInTheDocument();

  // A basic sanity check, not this repo's primary regression coverage: jsdom
  // never reproduced the handoff race against the pre-fix implementation
  // no matter how long this waited (verified up to 1s) — real Chromium does,
  // reliably, which is what e2e/mobile-sheet-history.touch.spec.ts exercises.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.getByText("Log a fuel fill")).toBeInTheDocument();
});

test("Expense opens the record-expense sheet, and it stays open on a touch device (GAP-104)", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(<QuickAddSheetHarness />, { get });

  await user.click(screen.getByRole("button", { name: "Expense" }));
  expect(await screen.findByRole("heading", { name: "Record expense" })).toBeInTheDocument();

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.getByRole("heading", { name: "Record expense" })).toBeInTheDocument();
});

test("New trip picks a vehicle, then reports it — no route change of its own (§3.1)", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  const onBookTrip = vi.fn();
  renderWithProviders(<QuickAddSheetHarness onBookTrip={onBookTrip} />, { get });

  await user.click(screen.getByRole("button", { name: "New trip" }));
  await user.click(await screen.findByRole("button", { name: "NC-1234" }));

  expect(onBookTrip).toHaveBeenCalledWith("v1");
});

test("GAP-101: a failed vehicle-list read shows a notice in the New trip picker, never a silently empty list", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<QuickAddSheetHarness />, { get });

  await user.click(screen.getByRole("button", { name: "New trip" }));

  expect(
    await screen.findByText("Something went wrong loading the vehicle list."),
  ).toBeInTheDocument();
});
