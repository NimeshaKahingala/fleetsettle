import { asBusinessDate } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  DriverResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { __resetSheetHistoryStackForTests } from "../../lib/useMobileHistoryDismiss.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { QuickAddSheet } from "./QuickAddSheet.js";

const today = asBusinessDate("2026-08-04");

const vehicles: VehicleResponse[] = [
  {
    id: "v1",
    registration: "NC-1234",
    vehicleType: "bus",
    lifecycle: "active",
    serviceIntervalKm: null,
    arrangement: "B",
  },
];
const customers: CustomerResponse[] = [
  {
    id: "c1",
    customerType: "person",
    name: "Nimal",
    nic: null,
    registrationNo: null,
    contactPerson: null,
    mobile: "0711111111",
    address: null,
  },
];
const drivers: DriverResponse[] = [
  {
    id: "d1",
    name: "Sunil",
    mobile: "0722222222",
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  },
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

function baseGet<T>(path: string): Promise<T> {
  if (path === "/api/customer") return Promise.resolve(customers as T);
  if (path === "/api/driver") return Promise.resolve(drivers as T);
  if (path === "/api/vehicle") return Promise.resolve(vehicles as T);
  return Promise.reject(new Error(`Unexpected GET ${path}`));
}

async function enterAmount(user: ReturnType<typeof userEvent.setup>, amountButton: string) {
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  await user.click(screen.getByRole("button", { name: amountButton }));
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("offers all five M-4 actions in the fixed order", () => {
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(<QuickAddSheetHarness />, { get });

  const buttons = screen.getAllByRole("button").map((b) => b.textContent);
  const fuelIndex = buttons.indexOf("Fuel");
  const expenseIndex = buttons.indexOf("Expense");
  const receivedIndex = buttons.indexOf("Payment received");
  const madeIndex = buttons.indexOf("Payment made");
  const tripIndex = buttons.indexOf("New trip");
  expect(fuelIndex).toBeGreaterThanOrEqual(0);
  expect(fuelIndex).toBeLessThan(expenseIndex);
  expect(expenseIndex).toBeLessThan(receivedIndex);
  expect(receivedIndex).toBeLessThan(madeIndex);
  expect(madeIndex).toBeLessThan(tripIndex);
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
  expect(screen.queryByRole("heading", { name: "Add" })).not.toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "New trip — choose a vehicle" }),
  ).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "NC-1234" }));

  expect(onBookTrip).toHaveBeenCalledWith("v1");
});

test("B15/GAP-82: Payment received picks a customer and posts a received payment", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "p1",
    amountMinor: "5",
    occurredOn: today,
    allocations: [],
    unallocatedMinor: "500",
  });
  renderWithProviders(<QuickAddSheetHarness />, { get: baseGet, post });

  await user.click(screen.getByRole("button", { name: "Payment received" }));
  await user.click(await screen.findByRole("button", { name: "Customer - Nimal" }));

  expect(screen.getByRole("heading", { name: "Record payment received" })).toBeInTheDocument();
  expect(screen.getByText("Customer - Nimal")).toBeInTheDocument();

  await enterAmount(user, "5");
  await user.click(screen.getByRole("button", { name: "Record payment" }));

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/payment", {
      direction: "received",
      partyType: "customer",
      partyId: "c1",
      amountMinor: "5",
      occurredOn: today,
    }),
  );
});

test("B15/GAP-82: Payment made picks a driver and posts a paid payment", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "p1",
    amountMinor: "7",
    occurredOn: today,
    allocations: [],
    unallocatedMinor: "700",
  });
  renderWithProviders(<QuickAddSheetHarness />, { get: baseGet, post });

  await user.click(screen.getByRole("button", { name: "Payment made" }));
  await user.click(await screen.findByRole("button", { name: "Driver - Sunil" }));

  expect(screen.getByRole("heading", { name: "Record payment made" })).toBeInTheDocument();
  expect(screen.getByText("Driver - Sunil")).toBeInTheDocument();

  await enterAmount(user, "7");
  await user.click(screen.getByRole("button", { name: "Record payment made" }));

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/payment", {
      direction: "paid",
      partyType: "driver",
      partyId: "d1",
      amountMinor: "7",
      occurredOn: today,
    }),
  );
});

test("GAP-101: a failed customer-list read shows a notice in the Payment received picker", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/customer") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/driver") return Promise.resolve(drivers);
    return Promise.resolve(vehicles);
  });
  renderWithProviders(<QuickAddSheetHarness />, { get });

  await user.click(screen.getByRole("button", { name: "Payment received" }));

  expect(
    await screen.findByText("Something went wrong loading the customer list."),
  ).toBeInTheDocument();
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

/**
 * GAP-125: reproduced live 14 Aug 2026 against qa.fleetsettle.com — the
 * New trip picker's `/api/vehicle` read is `enabled`-gated on the picker
 * being open, so every open has a real fetch-in-flight window (widened to
 * 500-800ms under Slow 4G there), and `ReasonPicker` used to have no
 * pending branch at all, rendering a silently empty list for that whole
 * window. This is the case a settled `screen.findByRole` query would have
 * hidden — the deferred `get` below is what keeps the query pending long
 * enough to observe the loading state before resolving it.
 */
test("GAP-125: New trip shows a loading notice while the vehicle list is in flight, never a silently empty list", async () => {
  const user = userEvent.setup();
  let resolveVehicles: ((value: VehicleResponse[]) => void) | undefined;
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle") {
      return new Promise<VehicleResponse[]>((resolve) => {
        resolveVehicles = resolve;
      });
    }
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  renderWithProviders(<QuickAddSheetHarness />, { get });

  await user.click(screen.getByRole("button", { name: "New trip" }));

  expect(await screen.findByText("Loading…")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "NC-1234" })).not.toBeInTheDocument();

  resolveVehicles?.(vehicles);
  expect(await screen.findByRole("button", { name: "NC-1234" })).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});
