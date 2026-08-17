import { asBusinessDate } from "@fleetsettle/shared";
import type { PaymentListRow } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CorrectPaymentSheet } from "./CorrectPaymentSheet.js";

const today = asBusinessDate("2026-07-15");

const payment: PaymentListRow = {
  id: "p1",
  direction: "received",
  partyType: "customer",
  partyCustomerId: "c1",
  partyDriverId: null,
  partyUserId: null,
  amountMinor: "500000",
  occurredOn: "2026-07-10",
  method: null,
  reference: null,
  status: "active",
};

test("renders the recorded amount and the correction fields", async () => {
  const get = vi.fn().mockResolvedValue({ entries: [] });
  renderWithProviders(
    <CorrectPaymentSheet
      open
      onOpenChange={() => {}}
      payment={payment}
      today={today}
      onCorrected={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Rs 5,000")).toBeInTheDocument();
  expect(screen.getByText("He still owes it")).toBeInTheDocument();
  expect(screen.getByText("We absorb it")).toBeInTheDocument();
});

/**
 * GAP-130: `auditQuery.data?.entries ?? []` reads as empty for the whole
 * in-flight window, indistinguishable from a payment that genuinely has no
 * history without a pending branch. A never-resolving audit-log fetch
 * keeps the query pending for the whole assertion window.
 */
test("GAP-130: shows a loading notice under History, not a silently absent section, while the audit read is in flight", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/audit-log/payment/p1") return new Promise<never>(() => {});
    return Promise.resolve([]);
  });
  renderWithProviders(
    <CorrectPaymentSheet
      open
      onOpenChange={() => {}}
      payment={payment}
      today={today}
      onCorrected={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("History")).toBeInTheDocument();
  expect(screen.getByText("Loading…")).toBeInTheDocument();
});

test("GAP-101: a failed audit-history read shows a failure notice, never a silently absent History section", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/audit-log/payment/p1") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    return Promise.resolve([]);
  });
  renderWithProviders(
    <CorrectPaymentSheet
      open
      onOpenChange={() => {}}
      payment={payment}
      today={today}
      onCorrected={() => {}}
    />,
    { get },
  );

  expect(
    await screen.findByText("Something went wrong loading this payment's history."),
  ).toBeInTheDocument();
});
