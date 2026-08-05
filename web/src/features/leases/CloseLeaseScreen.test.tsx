import { asBusinessDate } from "@fleetsettle/shared";
import type {
  ClosedLeaseFinalPeriodResponse,
  CustomerResponse,
  LeaseClosureSummaryResponse,
  LeaseDepositResponse,
  LeaseResponse,
} from "@fleetsettle/shared/schemas";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CloseLeaseScreen } from "./CloseLeaseScreen.js";

const today = asBusinessDate("2026-07-15");

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

const emptySummary: LeaseClosureSummaryResponse = {
  unpaidObligations: [],
  totalUnpaidMinor: "0",
  openIncidents: [],
};

const finalPeriod: ClosedLeaseFinalPeriodResponse = {
  billingPeriodId: "bp1",
  obligationId: "o1",
  periodEnd: "2026-07-15",
  daysCount: 4,
  allowanceKm: 400,
  amountMinor: "900000",
};

/** Every scoped read this screen fetches defaults to the lease/customer pair, the same `baseGet` convention `LeaseHubScreen.test.tsx` already established. */
function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/lease/l1") return Promise.resolve(lease);
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/lease/l1/closure-summary") return Promise.resolve(emptySummary);
    if (path === "/api/lease/l1/deposit")
      return Promise.resolve(null satisfies LeaseDepositResponse | null);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  return get;
}

test("the happy path: no deposit, no closing reading, straight through to close-out", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/lease/l1/close") return Promise.resolve({ finalPeriod });
    if (path === "/api/lease/l1/close-out")
      return Promise.resolve({ ...lease, status: "closed" } satisfies LeaseResponse);
    return Promise.reject(new Error(`unexpected POST ${path}`));
  });
  const onClosed = vi.fn();
  renderWithProviders(
    <CloseLeaseScreen leaseId="l1" today={today} onBack={() => {}} onClosed={onClosed} />,
    { get, post },
  );

  expect(await screen.findByRole("heading", { name: "Acme Traders" })).toBeInTheDocument();
  expect(screen.getByText("Step 1 of 5 · Stop & final period")).toBeInTheDocument();
  // "Charge the days used" is the default finalPeriodMode.
  expect(screen.getByRole("button", { name: "Charge the days used" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await user.click(screen.getByRole("button", { name: "Stop the clock" }));

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/lease/l1/close", {
      closingDate: today,
      finalPeriodMode: "days_used",
    }),
  );

  // Step 2 — closure summary, plus the just-returned final period figure.
  expect(await screen.findByText("Step 2 of 5 · Closure summary")).toBeInTheDocument();
  expect(screen.getByText("This final period")).toBeInTheDocument();
  expect(screen.getByText("Rs 9,000")).toBeInTheDocument();
  // Back stops working the moment the lease is really `closing` (W-26).
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Step 3 of 5 · Condition")).toBeInTheDocument();
  expect(screen.getByText(/return condition photos/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Step 4 of 5 · Deposit")).toBeInTheDocument();
  expect(screen.getByText("No deposit was taken on this lease.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Step 5 of 5 · Close out")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Close out" }));

  await waitFor(() => expect(post).toHaveBeenCalledWith("/api/lease/l1/close-out", {}));
  expect(onClosed).toHaveBeenCalledWith("v1");
});

test("the closure summary lists unpaid dues and any open incident", async () => {
  const user = userEvent.setup();
  const get = baseGet({
    "/api/lease/l1/closure-summary": {
      unpaidObligations: [
        {
          id: "o2",
          kind: "mileage_excess",
          dueOn: "2026-06-11",
          amountMinor: "150000",
          settledMinor: "0",
          waivedMinor: "0",
        },
      ],
      totalUnpaidMinor: "150000",
      openIncidents: [{ id: "i1", occurredOn: "2026-05-01", status: "open" }],
    } satisfies LeaseClosureSummaryResponse,
  });
  const post = vi.fn().mockResolvedValue({ finalPeriod });
  renderWithProviders(
    <CloseLeaseScreen leaseId="l1" today={today} onBack={() => {}} onClosed={() => {}} />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Stop the clock" }));

  expect(await screen.findByText("Total unpaid")).toBeInTheDocument();
  expect(screen.getAllByText("Rs 1,500")).toHaveLength(2); // the total, and the one due that makes it up
  expect(screen.getByText("Unpaid dues · 1")).toBeInTheDocument();
  expect(screen.getByText("Mileage excess")).toBeInTheDocument();
  expect(screen.getByText("Open incidents · 1")).toBeInTheDocument();
});

test("an agreed figure keeps Stop the clock disabled until an amount is entered", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ finalPeriod });
  renderWithProviders(
    <CloseLeaseScreen leaseId="l1" today={today} onBack={() => {}} onClosed={() => {}} />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "An agreed figure" }));
  expect(screen.getByRole("button", { name: "Stop the clock" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Rs 0" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByRole("button", { name: "Stop the clock" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Stop the clock" }));

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/lease/l1/close", {
      closingDate: today,
      finalPeriodMode: "agreed",
      agreedAmountMinor: "5",
    }),
  );
});

test("reading the closing odometer now requires both a reading and a source before Stop the clock is enabled", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ finalPeriod });
  renderWithProviders(
    <CloseLeaseScreen leaseId="l1" today={today} onBack={() => {}} onClosed={() => {}} />,
    { get, post },
  );

  await user.click(await screen.findByText("Read the closing odometer now"));
  expect(screen.getByRole("button", { name: "Stop the clock" })).toBeDisabled();

  await user.type(screen.getByLabelText("Closing odometer (km)"), "45200");
  expect(screen.getByRole("button", { name: "Stop the clock" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "In person" }));
  expect(screen.getByRole("button", { name: "Stop the clock" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Stop the clock" }));

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/lease/l1/close", {
      closingDate: today,
      finalPeriodMode: "days_used",
      closingOdometerKm: 45200,
      odometerSource: "in_person",
    }),
  );
});

test("surfaces the server's error message on a failed close, and stays on step 0", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockRejectedValue(new Error("PERIOD_CLOSED"));
  renderWithProviders(
    <CloseLeaseScreen leaseId="l1" today={today} onBack={() => {}} onClosed={() => {}} />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Stop the clock" }));

  expect(await screen.findByText("PERIOD_CLOSED")).toBeInTheDocument();
  expect(screen.getByText("Step 1 of 5 · Stop & final period")).toBeInTheDocument();
});

test("a held deposit: retain requires an amount, then settling advances to close out", async () => {
  const user = userEvent.setup();
  const deposit: LeaseDepositResponse = {
    id: "d1",
    status: "held",
    heldMinor: "3000000",
    holdReleaseDate: null,
  };
  const get = baseGet({ "/api/lease/l1/deposit": deposit });
  const post = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/lease/l1/close") return Promise.resolve({ finalPeriod });
    if (path === "/api/lease/l1/settle-deposit")
      return Promise.resolve({
        depositId: "d1",
        status: "retained",
        heldMinor: "2500000",
        holdReleaseDate: null,
      });
    return Promise.reject(new Error(`unexpected POST ${path}`));
  });
  renderWithProviders(
    <CloseLeaseScreen leaseId="l1" today={today} onBack={() => {}} onClosed={() => {}} />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Stop the clock" }));
  await user.click(await screen.findByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  expect(await screen.findByText("Step 4 of 5 · Deposit")).toBeInTheDocument();
  expect(screen.getByText("Currently held")).toBeInTheDocument();
  expect(screen.getByText("Rs 30,000")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Retain" }));
  expect(screen.getByRole("button", { name: "Settle deposit" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Rs 0" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByRole("button", { name: "Settle deposit" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Settle deposit" }));

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/lease/l1/settle-deposit", {
      action: "retain",
      amountMinor: "5",
      occurredOn: today,
    }),
  );

  expect(await screen.findByText("Step 5 of 5 · Close out")).toBeInTheDocument();
});
