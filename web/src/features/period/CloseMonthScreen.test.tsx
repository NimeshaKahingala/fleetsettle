import { asBusinessDate } from "@fleetsettle/shared";
import type {
  CloseChecklistResponse,
  MeResponse,
  PaymentListRow,
} from "@fleetsettle/shared/schemas";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CloseMonthScreen } from "./CloseMonthScreen.js";

const today = asBusinessDate("2026-08-08");
const OWNER_MANAGER: MeResponse = { userId: "u1", businessId: "b1", role: "owner_manager" };
const MANAGER: MeResponse = { userId: "u2", businessId: "b1", role: "manager" };

const checklist: CloseChecklistResponse = {
  period: { id: "p1", periodStart: "2026-08-01", periodEnd: "2026-08-31" },
  checklist: {
    unconfirmedDays: 3,
    openTrips: 1,
    unreconciledAdvances: 0,
    pendingObligations: 5,
    openIncidents: 2,
    dayCardsGeneratedThrough: "2026-08-28",
  },
};

function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/accounting-period/checklist") return Promise.resolve(checklist);
    if (path === "/api/payment") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  return get;
}

test("all five checklist rows render, with their real counts (U-7: warns and lists, never blocks)", async () => {
  const get = baseGet();
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    OWNER_MANAGER,
  );

  expect(await screen.findByText("Days not yet confirmed")).toBeInTheDocument();
  expect(screen.getByText("Trips still open")).toBeInTheDocument();
  expect(screen.getByText("Advances not yet closed")).toBeInTheDocument();
  expect(screen.getByText("Dues still outstanding")).toBeInTheDocument();
  expect(screen.getByText("Incidents still open")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.getByText("5")).toBeInTheDocument();

  // U-7: the close button stays enabled regardless of the counts above.
  expect(screen.getByRole("button", { name: "Close this month" })).not.toBeDisabled();
});

test("§7.11: nonzero checklist rows get a warning structure, zero rows read as fine — never a flat list", async () => {
  const get = baseGet();
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    OWNER_MANAGER,
  );

  const daysRow = (await screen.findByText("Days not yet confirmed")).closest(
    '[class*="rounded-md"]',
  );
  expect(daysRow).not.toBeNull();
  // unconfirmedDays: 3 — needs attention.
  expect(daysRow?.querySelector("svg")).not.toBeNull();

  const advancesRow = screen.getByText("Advances not yet closed").closest('[class*="rounded-md"]');
  expect(advancesRow).not.toBeNull();
  // unreconciledAdvances: 0 — nothing to warn about, no icon.
  expect(advancesRow?.querySelector("svg")).toBeNull();
});

test("GAP-101: a failed checklist read shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period/checklist") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/payment") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    OWNER_MANAGER,
  );

  expect(
    await screen.findByText("Something went wrong loading the close checklist."),
  ).toBeInTheDocument();
});

test("GAP-101: a failed payments read shows a failure notice, never a false 'No payments recorded yet.'", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period/checklist") return Promise.resolve(checklist);
    if (path === "/api/payment") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    OWNER_MANAGER,
  );

  expect(
    await screen.findByText("Something went wrong loading recent payments."),
  ).toBeInTheDocument();
  expect(screen.queryByText("No payments recorded yet.")).not.toBeInTheDocument();
});

test("a manager never sees Close this month — absent, not disabled (M-22)", async () => {
  const get = baseGet();
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    MANAGER,
  );

  await screen.findByText("Days not yet confirmed");
  expect(screen.queryByRole("button", { name: "Close this month" })).not.toBeInTheDocument();
});

test("closing opens a Dialog whose confirm label states the consequence, never the bare word 'Confirm' (M-10)", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    OWNER_MANAGER,
  );

  await user.click(await screen.findByRole("button", { name: "Close this month" }));

  expect(await screen.findByText(/cannot be undone/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close August permanently" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
});

test("GAP-91: the irreversible close confirm carries destructive tone, not the ordinary primary button", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    OWNER_MANAGER,
  );

  await user.click(await screen.findByRole("button", { name: "Close this month" }));

  expect(await screen.findByRole("button", { name: "Close August permanently" })).toHaveClass(
    "bg-critical",
  );
});

test("confirming surfaces the newly opened successor period", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({
    closedPeriod: { id: "p1", periodStart: "2026-08-01", periodEnd: "2026-08-31" },
    newPeriod: { id: "p2", periodStart: "2026-09-01", periodEnd: "2026-09-30" },
    checklist: checklist.checklist,
  });
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get, post },
    () => Promise.resolve(),
    OWNER_MANAGER,
  );

  await user.click(await screen.findByRole("button", { name: "Close this month" }));
  await user.click(await screen.findByRole("button", { name: "Close August permanently" }));

  expect(await screen.findByText(/is closed\./)).toBeInTheDocument();
  expect(screen.getByText(/1 September 2026.*is now open/)).toBeInTheDocument();
  await waitFor(() => expect(post).toHaveBeenCalledWith("/api/accounting-period/close", {}));
});

test("tapping a payment opens the correction sheet", async () => {
  const user = userEvent.setup();
  const payments: PaymentListRow[] = [
    {
      id: "pay1",
      direction: "received",
      partyType: "customer",
      partyCustomerId: "c1",
      partyDriverId: null,
      partyUserId: null,
      amountMinor: "70000",
      occurredOn: "2026-08-05",
      method: null,
      reference: null,
      status: "active",
    },
  ];
  const get = baseGet({
    "/api/payment": payments,
    "/api/audit-log/payment/pay1": { entries: [] },
    "/api/business-member": [],
  });
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    OWNER_MANAGER,
  );

  await user.click(await screen.findByText(/Received — customer/));

  expect(await screen.findByText("Correct this payment")).toBeInTheDocument();
  expect(screen.getByText("He still owes it")).toBeInTheDocument();
  expect(screen.getByText("We absorb it")).toBeInTheDocument();
});

test("a reversed payment cannot be re-opened for correction", async () => {
  const payments: PaymentListRow[] = [
    {
      id: "pay1",
      direction: "received",
      partyType: "customer",
      partyCustomerId: "c1",
      partyDriverId: null,
      partyUserId: null,
      amountMinor: "70000",
      occurredOn: "2026-08-05",
      method: null,
      reference: null,
      status: "reversed",
    },
  ];
  const get = baseGet({ "/api/payment": payments });
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    OWNER_MANAGER,
  );

  expect(await screen.findByText(/Received — customer/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Received — customer/ })).toBeDisabled();
});

test("a manager sees the payments list but cannot tap into a correction — reverseReceipt is owners-only (W-49/M-22)", async () => {
  const payments: PaymentListRow[] = [
    {
      id: "pay1",
      direction: "received",
      partyType: "customer",
      partyCustomerId: "c1",
      partyDriverId: null,
      partyUserId: null,
      amountMinor: "70000",
      occurredOn: "2026-08-05",
      method: null,
      reference: null,
      status: "active",
    },
  ];
  const get = baseGet({ "/api/payment": payments });
  renderWithProviders(
    <CloseMonthScreen today={today} onBack={() => {}} />,
    { get },
    () => Promise.resolve(),
    MANAGER,
  );

  expect(await screen.findByText(/Received — customer/)).toBeInTheDocument();
  // The information is visible (dailyOperations covers reading); the
  // affordance to correct it is not (reverseReceipt is owners-only) — no
  // button wraps the row at all for this role.
  expect(screen.queryByRole("button", { name: /Received — customer/ })).not.toBeInTheDocument();
});
