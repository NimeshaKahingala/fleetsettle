import type { ListAdjustmentsResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { AdjustmentsSheet } from "./AdjustmentsSheet.js";

const adjustments: ListAdjustmentsResponse = [
  {
    id: "adj1",
    obligationId: "o1",
    adjustmentType: "late_fee",
    amountMinor: "1000",
    sign: 1,
    reason: "Paid three days late",
    occurredOn: "2026-08-10",
    voidedAt: null,
    voidedReason: null,
    replacesId: null,
  },
];

test("lists adjustments against an obligation", async () => {
  const get = vi.fn().mockResolvedValue(adjustments);
  renderWithProviders(
    <AdjustmentsSheet open onOpenChange={vi.fn()} leaseId="l1" obligationId="o1" />,
    { get },
  );

  expect(await screen.findByText("Late fee")).toBeInTheDocument();
  expect(screen.getByText("Rs 10")).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/api/adjustment?obligationId=o1");
});

test("an empty list says so rather than showing nothing", async () => {
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(
    <AdjustmentsSheet open onOpenChange={vi.fn()} leaseId="l1" obligationId="o1" />,
    { get },
  );

  expect(await screen.findByText("No adjustments recorded yet.")).toBeInTheDocument();
});

test("a failed read shows a scoped failure", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <AdjustmentsSheet open onOpenChange={vi.fn()} leaseId="l1" obligationId="o1" />,
    { get },
  );

  expect(
    await screen.findByText("Something went wrong loading adjustments against this due."),
  ).toBeInTheDocument();
});

test("voids an adjustment, then returns to the list", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(adjustments);
  const post = vi.fn().mockResolvedValue({ voidedAt: "2026-08-20T00:00:00.000Z" });
  renderWithProviders(
    <AdjustmentsSheet open onOpenChange={vi.fn()} leaseId="l1" obligationId="o1" />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Void adjustment" }));
  await user.type(screen.getByLabelText("Reason"), "Entered against the wrong due");
  const submitButtons = screen.getAllByRole("button", { name: "Void adjustment" });
  const submit = submitButtons.at(-1);
  if (submit === undefined) throw new Error("expected void submit button");
  await user.click(submit);

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/adjustment/adj1/void", {
      reason: "Entered against the wrong due",
    }),
  );
});

test("Back to adjustments returns to the list without submitting", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(adjustments);
  const post = vi.fn();
  renderWithProviders(
    <AdjustmentsSheet open onOpenChange={vi.fn()} leaseId="l1" obligationId="o1" />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Void adjustment" }));
  await user.click(screen.getByRole("button", { name: "Back to adjustments" }));

  expect(await screen.findByText("Late fee")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
