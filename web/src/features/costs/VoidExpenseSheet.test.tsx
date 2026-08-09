import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { VoidExpenseSheet } from "./VoidExpenseSheet.js";

test("voids the expense with the reason and invalidates every list it appears on", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ id: "e1", voidedAt: "2026-08-08T10:00:00Z" });
  const onOpenChange = vi.fn();
  const { queryClient } = renderWithProviders(
    <VoidExpenseSheet
      open
      onOpenChange={onOpenChange}
      expenseId="e1"
      invalidateKeys={[["vehicle", "v1", "expense"]]}
    />,
    { post },
  );
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  await user.type(screen.getByLabelText("Reason"), "Wrong vehicle");
  await user.click(screen.getByRole("button", { name: "Void expense" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/expense/e1/void", { reason: "Wrong vehicle" }),
  );
  await vi.waitFor(() =>
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["vehicle", "v1", "expense"] }),
  );
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test("U-2: the submit button is disabled with no reason entered — a reason is required for a money void (F-8.5)", () => {
  renderWithProviders(
    <VoidExpenseSheet open onOpenChange={vi.fn()} expenseId="e1" invalidateKeys={[]} />,
  );

  expect(screen.getByRole("button", { name: "Void expense" })).toBeDisabled();
});

test("surfaces the server's PERIOD_CLOSED message rather than pre-checking it client-side", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockRejectedValue(new Error("That accounting period is closed"));
  renderWithProviders(
    <VoidExpenseSheet open onOpenChange={vi.fn()} expenseId="e1" invalidateKeys={[]} />,
    { post },
  );

  await user.type(screen.getByLabelText("Reason"), "Wrong vehicle");
  await user.click(screen.getByRole("button", { name: "Void expense" }));

  expect(await screen.findByText("That accounting period is closed")).toBeInTheDocument();
});
