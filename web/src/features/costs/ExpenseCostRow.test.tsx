import type { ExpenseListRow } from "@fleetsettle/shared/schemas";
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
