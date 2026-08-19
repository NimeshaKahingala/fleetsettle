import type {
  CustomerResponse,
  LeaseObligationRow,
  ListPaymentsResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CustomerDetailScreen } from "./CustomerDetailScreen.js";

const customer: CustomerResponse = {
  id: "c1",
  customerType: "organisation",
  name: "Acme Tours",
  nic: null,
  registrationNo: "PV-123",
  contactPerson: "Nimali",
  mobile: "0771234567",
  address: "Galle Road",
};

const due: LeaseObligationRow = {
  id: "o1",
  kind: "rent",
  dueOn: "2026-08-01",
  effectiveDueOn: "2026-08-01",
  amountMinor: "500000",
  settledMinor: "100000",
  waivedMinor: "0",
  status: "part_paid",
};

const payments: ListPaymentsResponse = [
  {
    id: "p1",
    direction: "received",
    partyType: "customer",
    partyCustomerId: "c1",
    partyDriverId: null,
    partyUserId: null,
    amountMinor: "100000",
    occurredOn: "2026-08-03",
    method: null,
    reference: null,
    status: "active",
  },
];

function baseGet() {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/customer/c1/obligation") return Promise.resolve([due]);
    if (path === "/api/customer/c1/payment") return Promise.resolve(payments);
    throw new Error(`unexpected path ${path}`);
  });
  return get;
}

test("GAP-22: renders customer details, outstanding dues and payment history", async () => {
  renderWithProviders(<CustomerDetailScreen customerId="c1" onBack={vi.fn()} />, {
    get: baseGet(),
  });

  expect(await screen.findByRole("heading", { name: "Acme Tours" })).toBeInTheDocument();
  expect(screen.getByText("Organisation")).toBeInTheDocument();
  expect(screen.getByText("PV-123")).toBeInTheDocument();
  expect(screen.getByText("Outstanding dues · 1")).toBeInTheDocument();
  expect(screen.getByText(/Part paid/)).toBeInTheDocument();
  expect(screen.getAllByText("Rs 4,000").length).toBeGreaterThan(0);
  expect(screen.getByText("Payments · 1")).toBeInTheDocument();
  expect(screen.getByText("Received")).toBeInTheDocument();
  expect(screen.getByText("Rs 1,000")).toBeInTheDocument();
});

test("§7.11: an outstanding due shows a due-age chip, matching the ageing report's own buckets", async () => {
  // vi.setSystemTime alone (no vi.useFakeTimers()) mocks Date without
  // touching setTimeout — Testing Library's async findBy* utilities need
  // real timers to poll, and fake timers here previously hung every test
  // after this one.
  vi.setSystemTime(new Date("2026-08-20T08:00:00Z"));
  try {
    renderWithProviders(<CustomerDetailScreen customerId="c1" onBack={vi.fn()} />, {
      get: baseGet(),
    });

    // due.effectiveDueOn is 2026-08-01; 19 days late lands in the "1-30"
    // bucket — the same boundaries listAgeingBuckets uses server-side.
    expect(await screen.findByText("1–30 days")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

/**
 * PR #60's own review (gitar-bot): `computeAgeingBucket` must bucket off
 * `effectiveDueOn`, not `dueOn` — every current obligation-insert path sets
 * them equal (so this diverging case cannot happen live yet), but the
 * fields are structurally two different columns and this pins the chip to
 * the right one regardless. `dueOn` set 19 days late (would read "1-30"),
 * `effectiveDueOn` set 80 days late — if the chip ever regresses to
 * bucketing off `dueOn`, this fails.
 */
test("the due-age chip buckets off effectiveDueOn, not dueOn, even when the two diverge", async () => {
  vi.setSystemTime(new Date("2026-08-20T08:00:00Z"));
  try {
    const divergentDue: LeaseObligationRow = {
      ...due,
      dueOn: "2026-08-01",
      effectiveDueOn: "2026-06-01",
    };
    const get = vi.fn();
    get.mockImplementation((path: string) => {
      if (path === "/api/customer/c1") return Promise.resolve(customer);
      if (path === "/api/customer/c1/obligation") return Promise.resolve([divergentDue]);
      if (path === "/api/customer/c1/payment") return Promise.resolve(payments);
      throw new Error(`unexpected path ${path}`);
    });

    renderWithProviders(<CustomerDetailScreen customerId="c1" onBack={vi.fn()} />, { get });

    expect(await screen.findByText("61–90 days")).toBeInTheDocument();
    expect(screen.queryByText("1–30 days")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

/** GAP-115: `duesState.kind === "error"` had no test — only the payments query's own failure branch did, leaving this screen's other `useQueryState` error path unverified. */
test("GAP-115/GAP-101: a failed customer dues read shows a scoped failure", async () => {
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/customer/c1/obligation") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-dues"));
    }
    if (path === "/api/customer/c1/payment") return Promise.resolve(payments);
    throw new Error(`unexpected path ${path}`);
  });

  renderWithProviders(<CustomerDetailScreen customerId="c1" onBack={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading this customer's dues."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Loading dues…")).not.toBeInTheDocument();
});

test("GAP-101: a failed customer payment history read shows a scoped failure", async () => {
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/customer/c1/obligation") return Promise.resolve([due]);
    if (path === "/api/customer/c1/payment") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-payment"));
    }
    throw new Error(`unexpected path ${path}`);
  });

  renderWithProviders(<CustomerDetailScreen customerId="c1" onBack={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading this customer's payments."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Loading payments…")).not.toBeInTheDocument();
});

test("collect payment reuses the party-level payment write and refreshes customer money reads", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "p2",
    amountMinor: "400000",
    occurredOn: "2026-08-11",
    allocations: [],
    unallocatedMinor: "0",
  });
  renderWithProviders(<CustomerDetailScreen customerId="c1" onBack={vi.fn()} />, {
    get: baseGet(),
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Collect payment" }));
  expect(await screen.findByRole("textbox", { name: "Amount received" })).toBeInTheDocument();
  for (const digit of "400000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Confirm" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/payment",
      expect.objectContaining({
        partyType: "customer",
        partyId: "c1",
        amountMinor: "400000",
      }),
    ),
  );
});

test("GAP-144: collecting payment here also invalidates Home's own receivables read", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "p2",
    amountMinor: "400000",
    occurredOn: "2026-08-11",
    allocations: [],
    unallocatedMinor: "0",
  });
  const { queryClient } = renderWithProviders(
    <CustomerDetailScreen customerId="c1" onBack={vi.fn()} />,
    {
      get: baseGet(),
      post,
    },
  );
  queryClient.setQueryData(["reports", "receivables"], [{ partyId: "c1" }]);

  await user.click(await screen.findByRole("button", { name: "Collect payment" }));
  await screen.findByRole("textbox", { name: "Amount received" });
  for (const digit of "400000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Confirm" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalled());
  expect(queryClient.getQueryState(["reports", "receivables"])?.isInvalidated).toBe(true);
});
