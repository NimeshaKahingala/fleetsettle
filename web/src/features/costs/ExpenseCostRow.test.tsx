import type {
  AttachmentResponse,
  ExpenseListRow,
  ListAttachmentsResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ExpenseCostRow } from "./ExpenseCostRow.js";

const liveExpense: ExpenseListRow = {
  id: "e1",
  vehicleId: "v1",
  tripId: null,
  incidentId: null,
  category: "repairs",
  amountMinor: "33333",
  spentOn: "2026-08-08",
  borneBy: "us",
  borneByDriverId: null,
  borneByCustomerId: null,
  paidByUserId: "u1",
  litres: null,
  note: null,
  voidedAt: null,
  voidedReason: null,
};

test("a live row is tappable and opens the void sheet", async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <ExpenseCostRow
      expense={liveExpense}
      formattedDate="8 Aug 2026"
      invalidateKeys={[["vehicle", "v1", "expense"]]}
    />,
  );

  expect(screen.queryByLabelText("Reason")).toBeNull();
  await user.click(screen.getByRole("button", { name: /Repairs/ }));

  expect(screen.getByLabelText("Reason")).toBeInTheDocument();
});

test("a voided row is not tappable — INV-21: it stays visible, struck through, and cannot be voided twice", () => {
  const voided: ExpenseListRow = {
    ...liveExpense,
    voidedAt: "2026-08-08T12:00:00Z",
    voidedReason: "Wrong vehicle",
  };
  renderWithProviders(
    <ExpenseCostRow expense={voided} formattedDate="8 Aug 2026" invalidateKeys={[]} />,
  );

  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Voided")).toBeInTheDocument();
  expect(screen.getByText("Wrong vehicle")).toBeInTheDocument();
});

test("the voided badge and reason use the critical token, not muted text (UI-LF-05)", () => {
  const voided: ExpenseListRow = {
    ...liveExpense,
    voidedAt: "2026-08-08T12:00:00Z",
    voidedReason: "Wrong vehicle",
  };
  renderWithProviders(
    <ExpenseCostRow expense={voided} formattedDate="8 Aug 2026" invalidateKeys={[]} />,
  );

  expect(screen.getByText("Voided").className).toContain("bg-critical/15");
  expect(screen.getByText("Wrong vehicle")).toHaveClass("text-critical-ink");
});

test("shows litres when present, unconditionally on every caller", () => {
  const fuelExpense: ExpenseListRow = { ...liveExpense, category: "fuel", litres: 42 };
  renderWithProviders(
    <ExpenseCostRow expense={fuelExpense} formattedDate="8 Aug 2026" invalidateKeys={[]} />,
  );

  expect(screen.getByText(/42ℓ/)).toBeInTheDocument();
});

test("passes the caller's own invalidateKeys through to the void mutation's success handler", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ id: "e1", voidedAt: "2026-08-08T10:00:00Z" });
  const { queryClient } = renderWithProviders(
    <ExpenseCostRow
      expense={liveExpense}
      formattedDate="8 Aug 2026"
      invalidateKeys={[["trip", "t1", "expense"]]}
    />,
    { post },
  );
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  await user.click(screen.getByRole("button", { name: /Repairs/ }));
  await user.type(screen.getByLabelText("Reason"), "Wrong trip");
  await user.click(screen.getByRole("button", { name: "Void expense" }));

  await vi.waitFor(() =>
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["trip", "t1", "expense"] }),
  );
});

test("no receipt indicator when the expense has no attachments", async () => {
  const get = vi.fn().mockResolvedValue([] satisfies ListAttachmentsResponse);
  renderWithProviders(
    <ExpenseCostRow expense={liveExpense} formattedDate="8 Aug 2026" invalidateKeys={[]} />,
    { get },
  );

  await vi.waitFor(() => expect(get).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /receipt/ })).toBeNull();
});

test("a receipt indicator shows the count and opens the receipt sheet — GAP-16 not honestly closed until a user can see what they uploaded", async () => {
  const user = userEvent.setup();
  const receipt: AttachmentResponse = {
    id: "att-1",
    kind: "expense_receipt",
    subjectType: "expense",
    subjectId: "e1",
    contentType: "image/jpeg",
    sizeBytes: 12345,
    uploadedAt: "2026-08-08T10:00:00Z",
  };
  const get = vi.fn().mockResolvedValue([receipt] satisfies ListAttachmentsResponse);
  const getBlob = vi
    .fn()
    .mockResolvedValue({
      blob: new Blob(["fake"], { type: "image/jpeg" }),
      contentType: "image/jpeg",
    });
  renderWithProviders(
    <ExpenseCostRow expense={liveExpense} formattedDate="8 Aug 2026" invalidateKeys={[]} />,
    { get, getBlob },
  );

  const indicator = await screen.findByRole("button", { name: "1 receipt" });
  // Voiding stays reachable and separate — the row's own tap target, not
  // buried behind the receipts indicator (GAP-81, finding F).
  expect(screen.getByRole("button", { name: /Repairs/ })).toBeInTheDocument();

  await user.click(indicator);
  expect(screen.getByText("Receipts")).toBeInTheDocument();
});

test("a voided expense's receipts stay visible — they are evidence of what was claimed", async () => {
  const voided: ExpenseListRow = {
    ...liveExpense,
    voidedAt: "2026-08-08T12:00:00Z",
    voidedReason: "Wrong vehicle",
  };
  const receipt: AttachmentResponse = {
    id: "att-1",
    kind: "expense_receipt",
    subjectType: "expense",
    subjectId: "e1",
    contentType: "image/jpeg",
    sizeBytes: 12345,
    uploadedAt: "2026-08-08T10:00:00Z",
  };
  const get = vi.fn().mockResolvedValue([receipt] satisfies ListAttachmentsResponse);
  renderWithProviders(
    <ExpenseCostRow expense={voided} formattedDate="8 Aug 2026" invalidateKeys={[]} />,
    { get },
  );

  expect(await screen.findByRole("button", { name: "1 receipt" })).toBeInTheDocument();
});
