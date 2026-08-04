import type {
  BillingPeriodResponse,
  CustomerResponse,
  LeaseObligationRow,
  LeaseResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { LeaseHubScreen } from "./LeaseHubScreen.js";

const lease: LeaseResponse = {
  id: "l1",
  vehicleId: "v1",
  customerId: "c1",
  status: "active",
  startDate: "2026-01-12",
  endDate: null,
  billingDay: 12,
  rentAmountMinor: "7000000",
  mileageDailyLimitKm: 100,
  mileageExcessRateMinor: "5000",
  reminderDaysBefore: 3,
};

const customer: CustomerResponse = {
  id: "c1",
  customerType: "person",
  name: "Acme Traders",
  nic: null,
  registrationNo: null,
  contactPerson: null,
  mobile: null,
  address: null,
};

const billingPeriods: BillingPeriodResponse[] = [
  {
    id: "bp1",
    leaseId: "l1",
    seq: 1,
    periodStart: "2026-01-12",
    periodEnd: "2026-02-11",
    daysCount: 31,
    rentAmountMinor: "7000000",
    allowanceKm: 3100,
  },
];

const dues: LeaseObligationRow[] = [
  {
    id: "o1",
    kind: "rent",
    dueOn: "2026-01-12",
    amountMinor: "7000000",
    settledMinor: "0",
    waivedMinor: "0",
    status: "pending",
  },
  {
    id: "o2",
    kind: "mileage_excess",
    dueOn: "2026-02-11",
    amountMinor: "50000",
    settledMinor: "50000",
    waivedMinor: "0",
    status: "paid",
  },
];

/** Every scoped read this screen fetches defaults to empty/undefined-safe, the same `baseGet` convention `VehicleOverviewScreen.test.tsx` already established. */
function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/lease/l1") return Promise.resolve(lease);
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    return Promise.resolve([]);
  });
  return get;
}

test("renders terms, billing periods and dues once loaded", async () => {
  const get = baseGet({
    "/api/lease/l1/billing-period": billingPeriods,
    "/api/lease/l1/obligation": dues,
  });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} />, { get });

  expect(await screen.findByRole("heading", { name: "Acme Traders" })).toBeInTheDocument();
  expect(screen.getByText("Active")).toBeInTheDocument();
  expect(screen.getByText("Rs 70,000", { selector: ".text-title" })).toBeInTheDocument();
  expect(screen.getByText(/km\/day/)).toHaveTextContent("100 km/day · Rs 50/km excess");

  expect(screen.getByText("Billing periods · 1")).toBeInTheDocument();
  expect(screen.getByText("Dues · 2")).toBeInTheDocument();
  expect(screen.getByText("Rent")).toBeInTheDocument();
  expect(screen.getByText("Mileage excess")).toBeInTheDocument();
  expect(screen.getByText(/Paid/)).toBeInTheDocument();
});

test("a pending due opens an action sheet offering collect payment and adjust or waive", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} />, { get });

  await user.click(await screen.findByText("Rent"));

  expect(await screen.findByRole("button", { name: "Collect payment" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Adjust or waive" })).toBeInTheDocument();
});

test("a due already paid is a plain row, not tappable", async () => {
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} />, { get });

  const paidRow = await screen.findByText("Mileage excess");
  expect(paidRow.closest("button")).toBeNull();
});

test("collect payment from an action sheet opens the amount step, pre-filled from that due", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} />, { get });

  await user.click(await screen.findByText("Rent"));
  await user.click(screen.getByRole("button", { name: "Collect payment" }));

  expect(await screen.findByText("Amount received")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Amount received" })).toHaveTextContent("Rs 70,000");
});

test("adjust or waive from an action sheet opens the adjust sheet for that due", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} />, { get });

  await user.click(await screen.findByText("Rent"));
  await user.click(screen.getByRole("button", { name: "Adjust or waive" }));

  expect(await screen.findByText("Type")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Waive" })).toBeInTheDocument();
});

test("the sticky Collect payment action opens the amount step with nothing pre-filled", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} />, { get });

  await user.click(await screen.findByRole("button", { name: "Collect payment" }));

  expect(await screen.findByText("Amount received")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Amount received" })).toHaveTextContent("Rs 0");
});

test("the Renew app-bar action opens the renew sheet, pre-filled with the current rent", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": [] });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} />, { get });

  await user.click(await screen.findByRole("button", { name: "Renew" }));

  expect(await screen.findByText("New monthly amount")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rs 70,000" })).toBeInTheDocument();
});
