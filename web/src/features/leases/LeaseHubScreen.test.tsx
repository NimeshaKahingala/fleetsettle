import type {
  BillingPeriodResponse,
  CustomerResponse,
  LeaseObligationRow,
  LeaseResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { LeaseHubScreen } from "./LeaseHubScreen.js";

const owner = { userId: "u1", businessId: "b1", role: "owner" as const };
const manager = { userId: "u1", businessId: "b1", role: "manager" as const };

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
    effectiveDueOn: "2026-01-12",
    amountMinor: "7000000",
    settledMinor: "0",
    waivedMinor: "0",
    status: "pending",
  },
  {
    id: "o2",
    kind: "mileage_excess",
    dueOn: "2026-02-11",
    effectiveDueOn: "2026-02-11",
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
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  expect(await screen.findByRole("heading", { name: "Acme Traders" })).toBeInTheDocument();
  expect(screen.getByText("Active")).toBeInTheDocument();
  // The monthly-amount StatTile, the billing period card and the "Rent"
  // due all happen to read 70,000 in this fixture — real occurrences, not
  // duplicates of the same fact.
  expect(screen.getAllByText("Rs 70,000").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/km\/day/)).toHaveTextContent("100 km/day · Rs 50/km excess");

  expect(screen.getByText("Billing periods · 1")).toBeInTheDocument();
  expect(screen.getByText("Dues · 2")).toBeInTheDocument();
  expect(screen.getByText("Rent")).toBeInTheDocument();
  expect(screen.getByText("Mileage excess")).toBeInTheDocument();
  expect(screen.getByText(/Paid/)).toBeInTheDocument();
});

test("GAP-101: a failed lease read shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Something went wrong loading this lease.")).toBeInTheDocument();
});

test("GAP-101: a failed dues read shows a failure notice, never a silently empty 'Dues' section that hides money owed", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/lease/l1/obligation") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/lease/l1") return Promise.resolve(lease);
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    return Promise.resolve([]);
  });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Something went wrong loading dues.")).toBeInTheDocument();
  expect(screen.queryByText(/Dues ·/)).not.toBeInTheDocument();
});

test("a pending due opens an action sheet offering collect payment and adjust or waive", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  await user.click(await screen.findByText("Rent"));

  expect(await screen.findByRole("button", { name: "Collect payment" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Adjust or waive" })).toBeInTheDocument();
});

test("a due already paid is a plain row, not tappable", async () => {
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  const paidRow = await screen.findByText("Mileage excess");
  expect(paidRow.closest("button")).toBeNull();
});

test("collect payment from an action sheet opens the amount step, pre-filled from that due", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  await user.click(await screen.findByText("Rent"));
  await user.click(screen.getByRole("button", { name: "Collect payment" }));

  expect(await screen.findByText("Amount received")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Amount received" })).toHaveTextContent("Rs 70,000");
});

test("GAP-144: collecting payment here invalidates Home's own receivables read, not just this lease's own obligation list", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  const post = vi.fn().mockResolvedValue({
    id: "p1",
    amountMinor: "7000000",
    occurredOn: "2026-08-01",
    allocations: [],
    unallocatedMinor: "0",
  });
  const { queryClient } = renderWithProviders(
    <LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />,
    { get, post },
  );
  queryClient.setQueryData(["reports", "receivables"], [{ partyId: "c1" }]);

  await user.click(await screen.findByText("Rent"));
  await user.click(screen.getByRole("button", { name: "Collect payment" }));
  await screen.findByText("Amount received");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(await screen.findByRole("button", { name: "Confirm" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalled());
  expect(queryClient.getQueryState(["reports", "receivables"])?.isInvalidated).toBe(true);
});

test("adjust or waive from an action sheet opens the adjust sheet for that due", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  await user.click(await screen.findByText("Rent"));
  await user.click(screen.getByRole("button", { name: "Adjust or waive" }));

  expect(await screen.findByText("Type")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Waive" })).toBeInTheDocument();
});

test("F-8.3/GAP-148: an owner can write off a selected due from the lease hub", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  const post = vi.fn().mockResolvedValue({
    id: "wo1",
    obligationId: "o1",
    partyType: "customer",
    partyCustomerId: "c1",
    partyDriverId: null,
    vehicleId: "v1",
    amountMinor: "7000000",
    reason: "Customer disappeared",
    writtenOffOn: "2026-08-20",
    replacesId: null,
  });
  renderWithProviders(
    <LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />,
    { get, post },
    undefined,
    owner,
  );

  await user.click(await screen.findByText("Rent"));
  await user.click(screen.getByRole("button", { name: "Write off" }));
  await user.type(screen.getByLabelText("Reason"), "Customer disappeared");
  await user.click(screen.getByRole("button", { name: "Write off" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/write-off",
      expect.objectContaining({
        obligationId: "o1",
        partyType: "customer",
        partyCustomerId: "c1",
        vehicleId: "v1",
        amountMinor: "7000000",
        reason: "Customer disappeared",
      }),
    ),
  );
});

test("F-8.3/M-22: a manager does not see the owner-only write-off action", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(
    <LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />,
    { get },
    undefined,
    manager,
  );

  await user.click(await screen.findByText("Rent"));

  expect(screen.queryByRole("button", { name: "Write off" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Adjust or waive" })).toBeInTheDocument();
});

test("the sticky Collect payment action opens the amount step with nothing pre-filled", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  await user.click(await screen.findByRole("button", { name: "Collect payment" }));

  expect(await screen.findByText("Amount received")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Amount received" })).toHaveTextContent("Rs 0");
});

test("the lease-actions app-bar action lists Renew, Read odometer and Close the lease", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": [] });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  await user.click(await screen.findByRole("button", { name: "Lease actions" }));

  expect(screen.getByRole("button", { name: "Renew" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Read odometer" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close the lease" })).toBeInTheDocument();
});

test("Renew, from the lease-actions sheet, opens the renew sheet pre-filled with the current rent", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": [] });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  await user.click(await screen.findByRole("button", { name: "Lease actions" }));
  await user.click(screen.getByRole("button", { name: "Renew" }));

  expect(await screen.findByText("New monthly amount")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rs 70,000" })).toBeInTheDocument();
});

test("Read odometer, from the lease-actions sheet, opens the reading form", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": [] });
  renderWithProviders(<LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />, {
    get,
  });

  await user.click(await screen.findByRole("button", { name: "Lease actions" }));
  await user.click(screen.getByRole("button", { name: "Read odometer" }));

  expect(await screen.findByText("Source")).toBeInTheDocument();
  expect(screen.getByLabelText("Reading (km)")).toBeInTheDocument();
});

test("Close the lease, from the lease-actions sheet, calls onCloseLease", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": [] });
  const onCloseLease = vi.fn();
  renderWithProviders(
    <LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={onCloseLease} />,
    { get },
  );

  await user.click(await screen.findByRole("button", { name: "Lease actions" }));
  await user.click(screen.getByRole("button", { name: "Close the lease" }));

  expect(onCloseLease).toHaveBeenCalledOnce();
});

test("F-8.4/GAP-148: a closed lease can record a late charge from lease actions", async () => {
  const user = userEvent.setup();
  const closedLease: LeaseResponse = { ...lease, status: "closed", endDate: "2026-07-31" };
  const get = baseGet({
    "/api/lease/l1": closedLease,
    "/api/lease/l1/obligation": dues,
  });
  const post = vi.fn().mockResolvedValue({
    obligationId: "o-late",
    partyType: "customer",
    amountMinor: "125000",
    dueOn: "2026-08-20",
    status: "pending",
    replacesId: null,
    deductedFromFeeOffsetId: null,
  });
  renderWithProviders(
    <LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />,
    { get, post },
    undefined,
    manager,
  );

  await user.click(await screen.findByRole("button", { name: "Lease actions" }));

  expect(screen.getByRole("button", { name: "Record late charge" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close the lease" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Record late charge" }));
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of "125000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.type(screen.getByLabelText("Note"), "Parking ticket after return");
  await user.click(screen.getByRole("button", { name: "Record charge" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/post-closure-charge",
      expect.objectContaining({
        partyType: "customer",
        partyCustomerId: "c1",
        vehicleId: "v1",
        sourceType: "lease",
        sourceId: "l1",
        amountMinor: "125000",
        note: "Parking ticket after return",
      }),
    ),
  );
});

test("F-8.4: an active lease does not expose the post-closure charge action", async () => {
  const user = userEvent.setup();
  const get = baseGet({ "/api/lease/l1/obligation": dues });
  renderWithProviders(
    <LeaseHubScreen leaseId="l1" onBack={() => {}} onCloseLease={() => {}} />,
    { get },
    undefined,
    manager,
  );

  await user.click(await screen.findByRole("button", { name: "Lease actions" }));

  expect(screen.getByRole("button", { name: "Close the lease" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Record late charge" })).not.toBeInTheDocument();
});
