import type {
  CustomerResponse,
  LeaseObligationRow,
  ListPaymentsResponse,
  ListWriteOffsResponse,
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

const writeOffs: ListWriteOffsResponse = [
  {
    id: "wo1",
    obligationId: "o1",
    partyType: "customer",
    partyCustomerId: "c1",
    partyDriverId: null,
    vehicleId: "v1",
    amountMinor: "400000",
    reason: "Customer disappeared",
    writtenOffOn: "2026-08-10",
    voidedAt: null,
    voidedReason: null,
    replacesId: null,
  },
];

const manager = { userId: "u1", businessId: "b1", role: "manager" as const };
const owner = { userId: "u1", businessId: "b1", role: "owner" as const };

function baseGet() {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/customer/c1/obligation") return Promise.resolve([due]);
    if (path === "/api/customer/c1/payment") return Promise.resolve(payments);
    if (path.startsWith("/api/write-off?")) return Promise.resolve([]);
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

test("GAP-146: a customer can be archived from customer detail with a reason", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...customer, archivedAt: "2026-08-20T00:00:00.000Z" });
  renderWithProviders(<CustomerDetailScreen customerId="c1" onBack={vi.fn()} />, {
    get: baseGet(),
    post,
  });

  expect(await screen.findByText("Active")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Customer actions" }));
  await user.click(await screen.findByRole("button", { name: "Archive customer" }));
  expect(await screen.findByText("Archive customer?")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Reason"), "Duplicate customer");
  await user.click(screen.getByRole("button", { name: "Archive customer" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/customer/c1/archive", {
      reason: "Duplicate customer",
    }),
  );
});

test("GAP-146: an archived customer can be unarchived from customer detail", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/customer/c1") {
      return Promise.resolve({ ...customer, archivedAt: "2026-08-20T00:00:00.000Z" });
    }
    if (path === "/api/customer/c1/obligation") return Promise.resolve([]);
    if (path === "/api/customer/c1/payment") return Promise.resolve([]);
    if (path.startsWith("/api/write-off?")) return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({ ...customer, archivedAt: null });
  renderWithProviders(<CustomerDetailScreen customerId="c1" onBack={vi.fn()} />, { get, post });

  expect(await screen.findByText("Archived")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Customer actions" }));
  await user.click(await screen.findByRole("button", { name: "Unarchive customer" }));
  expect(await screen.findByText("Unarchive customer?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Unarchive customer" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/customer/c1/unarchive", {}));
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
      if (path.startsWith("/api/write-off?")) return Promise.resolve([]);
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
    if (path.startsWith("/api/write-off?")) return Promise.resolve([]);
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
    if (path.startsWith("/api/write-off?")) return Promise.resolve([]);
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

test("UC-90/GAP-148: an owner can write off a vehicle-linked standalone customer balance from customer detail", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/customer/c1/obligation") return Promise.resolve([]);
    if (path === "/api/customer/c1/payment") return Promise.resolve([]);
    if (path.startsWith("/api/write-off?")) return Promise.resolve([]);
    if (path === "/api/vehicle") {
      return Promise.resolve([
        {
          id: "v1",
          registration: "CAB-1234",
          vehicleType: "Car",
          lifecycle: "active",
          arrangement: "A",
          serviceIntervalKm: null,
        },
      ]);
    }
    throw new Error(`unexpected path ${path}`);
  });
  const postCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const post = vi.fn().mockImplementation((path: string, body: Record<string, unknown>) => {
    postCalls.push({ path, body });
    return Promise.resolve({
      id: "wo-standalone",
      obligationId: null,
      partyType: "customer",
      partyCustomerId: "c1",
      partyDriverId: null,
      vehicleId: "v1",
      amountMinor: "400000",
      reason: "Bad debt after review",
      writtenOffOn: "2026-08-20",
      voidedAt: null,
      voidedReason: null,
      replacesId: null,
    });
  });
  renderWithProviders(
    <CustomerDetailScreen customerId="c1" onBack={vi.fn()} />,
    { get, post },
    undefined,
    owner,
  );

  await screen.findByRole("heading", { name: "Acme Tours" });
  await user.click(screen.getByRole("button", { name: "Customer actions" }));
  await user.click(await screen.findByRole("button", { name: "Write off balance" }));
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of "400000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.type(screen.getByLabelText("Reason"), "Bad debt after review");
  await user.click(await screen.findByRole("button", { name: "Choose vehicle" }));
  await user.click(await screen.findByText("CAB-1234"));
  await user.click(screen.getByRole("button", { name: "Write off" }));

  await vi.waitFor(() => expect(postCalls.length).toBeGreaterThan(0));
  const writeOffCall = postCalls.find(({ path }) => path === "/api/write-off");
  if (writeOffCall === undefined) throw new Error("expected customer write-off request");
  expect(writeOffCall.body).toMatchObject({
    partyType: "customer",
    partyCustomerId: "c1",
    vehicleId: "v1",
    amountMinor: "400000",
    reason: "Bad debt after review",
  });
  expect(writeOffCall.body).toHaveProperty(
    "writtenOffOn",
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  );
  expect(writeOffCall.body).not.toHaveProperty("obligationId");
});

test("UC-90/GAP-148: an owner can recover a customer write-off from customer detail", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/customer/c1/obligation") return Promise.resolve([]);
    if (path === "/api/customer/c1/payment") return Promise.resolve([]);
    if (path.startsWith("/api/write-off?")) return Promise.resolve(writeOffs);
    throw new Error(`unexpected path ${path}`);
  });
  const postCalls: Array<{ path: string; body: unknown }> = [];
  const post = vi.fn().mockImplementation((path: string, body: unknown) => {
    postCalls.push({ path, body });
    return Promise.resolve({
      id: "wor1",
      writeOffId: "wo1",
      paymentId: "p-recovery",
      amountMinor: "100000",
      replacesId: null,
    });
  });
  renderWithProviders(
    <CustomerDetailScreen customerId="c1" onBack={vi.fn()} />,
    { get, post },
    undefined,
    owner,
  );

  expect(await screen.findByText("Written off losses · 1")).toBeInTheDocument();
  expect(screen.getByText("Customer disappeared")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Record recovery" }));
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of "100000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  const recoveryButtons = screen.getAllByRole("button", { name: "Record recovery" });
  const recoverySubmit = recoveryButtons.at(-1);
  if (recoverySubmit === undefined) throw new Error("expected recovery submit button");
  await user.click(recoverySubmit);

  await vi.waitFor(() => expect(postCalls.length).toBeGreaterThan(0));
  const recoveryCall = postCalls.find(({ path }) => path === "/api/write-off/wo1/recovery");
  if (recoveryCall === undefined) throw new Error("expected write-off recovery request");
  expect(recoveryCall.body).toMatchObject({ amountMinor: "100000" });
  expect(recoveryCall.body).toHaveProperty(
    "occurredOn",
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  );
});

test("GAP-147/GAP-148: an owner can void a customer write-off from customer detail", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/customer/c1/obligation") return Promise.resolve([]);
    if (path === "/api/customer/c1/payment") return Promise.resolve([]);
    if (path.startsWith("/api/write-off?")) return Promise.resolve(writeOffs);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({
    id: "wo1",
    voidedAt: "2026-08-20T00:00:00.000Z",
  });
  renderWithProviders(
    <CustomerDetailScreen customerId="c1" onBack={vi.fn()} />,
    { get, post },
    undefined,
    owner,
  );

  expect(await screen.findByText("Written off losses · 1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Void write-off" }));
  await user.type(screen.getByLabelText("Reason"), "Entered against the wrong customer");
  const voidButtons = screen.getAllByRole("button", { name: "Void write-off" });
  const voidSubmit = voidButtons.at(-1);
  if (voidSubmit === undefined) throw new Error("expected void write-off submit button");
  await user.click(voidSubmit);

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/write-off/wo1/void", {
      reason: "Entered against the wrong customer",
    }),
  );
});

test("GAP-148: a manager sees no write-off section and no failure banner on customer detail", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/customer/c1/obligation") return Promise.resolve([due]);
    if (path === "/api/customer/c1/payment") return Promise.resolve(payments);
    // `listWriteOffsHandler` is `writeOffOrWaiveAboveThreshold` — owners only —
    // so a manager's request 403s. The screen must not make it in the first
    // place, and must not render the refusal as a broken-page banner.
    if (path.startsWith("/api/write-off?"))
      return Promise.reject(new ApiError(403, "FORBIDDEN_CAPABILITY", "boom", "req-wo"));
    throw new Error(`unexpected path ${path}`);
  });

  renderWithProviders(
    <CustomerDetailScreen customerId="c1" onBack={vi.fn()} />,
    { get },
    undefined,
    manager,
  );

  expect(await screen.findByRole("heading", { name: "Acme Tours" })).toBeInTheDocument();
  expect(screen.getByText("Payments · 1")).toBeInTheDocument();
  expect(
    get.mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].startsWith("/api/write-off?"),
    ),
  ).toBe(false);
  expect(screen.queryByText(/write-offs/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Written off losses/)).not.toBeInTheDocument();
});
