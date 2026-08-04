import { asBusinessDate, parse } from "@fleetsettle/shared";
import type { LeaseObligationRow } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CollectPaymentSheet } from "./CollectPaymentSheet.js";

const today = asBusinessDate("2026-07-15");

const olderDue: LeaseObligationRow = {
  id: "o1",
  kind: "rent",
  dueOn: "2026-06-01",
  amountMinor: "500000",
  settledMinor: "0",
  waivedMinor: "0",
  status: "pending",
};

const newerDue: LeaseObligationRow = {
  id: "o2",
  kind: "rent",
  dueOn: "2026-07-01",
  amountMinor: "300000",
  settledMinor: "0",
  waivedMinor: "0",
  status: "pending",
};

const dues: LeaseObligationRow[] = [olderDue, newerDue];

async function typeAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("allocates oldest-first before writing, and shows any remainder as held credit (§6.5)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "p1",
    amountMinor: "900000",
    occurredOn: today,
    allocations: [],
    unallocatedMinor: "100000",
  });
  const onOpenChange = vi.fn();
  renderWithProviders(
    <CollectPaymentSheet
      open
      onOpenChange={onOpenChange}
      leaseId="l1"
      customerId="c1"
      customerName="Acme Traders"
      dues={dues}
      today={today}
    />,
    { post },
  );

  // 900000 minor units — more than both dues (500000 + 300000) combined.
  await typeAmount(user, "900000");

  expect(screen.getByText(/Received/)).toHaveTextContent("Received Rs 9,000 from Acme Traders");
  const lineTexts = screen.getAllByRole("listitem").map((el) => el.textContent ?? "");
  expect(lineTexts).toHaveLength(2);
  expect(lineTexts[0]).toContain("Rs 5,000");
  expect(lineTexts[1]).toContain("Rs 3,000");
  expect(screen.getByText(/held as credit/)).toHaveTextContent("held as credit: Rs 1,000");

  await user.click(screen.getByRole("button", { name: "Confirm" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/payment", {
      partyType: "customer",
      partyId: "c1",
      amountMinor: "900000",
      occurredOn: today,
    }),
  );
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test("a due already settled or waived is skipped by the client-side preview", async () => {
  const user = userEvent.setup();
  const mixedDues: LeaseObligationRow[] = [
    { ...olderDue, status: "paid", settledMinor: "500000" },
    newerDue,
  ];
  renderWithProviders(
    <CollectPaymentSheet
      open
      onOpenChange={() => {}}
      leaseId="l1"
      customerId="c1"
      customerName="Acme Traders"
      dues={mixedDues}
      today={today}
    />,
    { post: vi.fn() },
  );

  await typeAmount(user, "300000");

  const lineTexts = screen.getAllByRole("listitem").map((el) => el.textContent ?? "");
  expect(lineTexts).toHaveLength(1);
  expect(lineTexts[0]).toContain("Rs 3,000");
  expect(screen.getByText(/nothing left/)).toBeInTheDocument();
});

test("change allocation returns to the amount step without losing what was typed", async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <CollectPaymentSheet
      open
      onOpenChange={() => {}}
      leaseId="l1"
      customerId="c1"
      customerName="Acme Traders"
      dues={dues}
      today={today}
    />,
    { post: vi.fn() },
  );

  await typeAmount(user, "500000");
  await user.click(screen.getByRole("button", { name: "Change allocation" }));

  expect(screen.getByRole("textbox", { name: "Amount received" })).toHaveTextContent("Rs 5,000");
});

test("a due tapped directly pre-fills its own outstanding amount", () => {
  renderWithProviders(
    <CollectPaymentSheet
      open
      onOpenChange={() => {}}
      leaseId="l1"
      customerId="c1"
      customerName="Acme Traders"
      dues={dues}
      today={today}
      initialAmountMinor={parse("300000")}
    />,
    { post: vi.fn() },
  );

  expect(screen.getByRole("textbox", { name: "Amount received" })).toHaveTextContent("Rs 3,000");
});
