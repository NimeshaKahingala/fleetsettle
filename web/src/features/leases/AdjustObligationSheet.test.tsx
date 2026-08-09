import type { LeaseObligationRow } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { AdjustObligationSheet } from "./AdjustObligationSheet.js";

const due: LeaseObligationRow = {
  id: "o1",
  kind: "mileage_excess",
  dueOn: "2026-07-11",
  amountMinor: "500000",
  settledMinor: "0",
  waivedMinor: "0",
  status: "pending",
};

async function enterAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("waiving defaults to sign -1 with no direction toggle shown — the schema pins it (DM §10.3)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "adj1",
    obligationId: "o1",
    adjustmentType: "waiver",
    amountMinor: "500000",
    sign: -1,
    reason: null,
  });
  const onOpenChange = vi.fn();
  renderWithProviders(
    <AdjustObligationSheet open onOpenChange={onOpenChange} leaseId="l1" due={due} />,
    { post },
  );

  expect(screen.queryByText("Direction")).not.toBeInTheDocument();

  await enterAmount(user, "500000");
  await user.click(screen.getByRole("button", { name: "Save adjustment" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/adjustment", {
      obligationId: "o1",
      adjustmentType: "waiver",
      amountMinor: "500000",
      sign: -1,
    }),
  );
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test("a late fee defaults to +1 and the direction can be flipped", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "adj2",
    obligationId: "o1",
    adjustmentType: "late_fee",
    amountMinor: "10000",
    sign: -1,
    reason: "goodwill instead",
  });
  renderWithProviders(
    <AdjustObligationSheet open onOpenChange={vi.fn()} leaseId="l1" due={due} />,
    {
      post,
    },
  );

  await user.click(screen.getByRole("button", { name: "Late fee" }));
  expect(screen.getByRole("button", { name: "Adds to what's owed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await user.click(screen.getByRole("button", { name: "Reduces what's owed" }));
  await user.type(screen.getByLabelText("Reason"), "goodwill instead");
  await enterAmount(user, "10000");
  await user.click(screen.getByRole("button", { name: "Save adjustment" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/adjustment", {
      obligationId: "o1",
      adjustmentType: "late_fee",
      amountMinor: "10000",
      sign: -1,
      reason: "goodwill instead",
    }),
  );
});

test("Save adjustment stays disabled until an amount is entered", () => {
  renderWithProviders(
    <AdjustObligationSheet open onOpenChange={vi.fn()} leaseId="l1" due={due} />,
    {
      post: vi.fn(),
    },
  );

  expect(screen.getByRole("button", { name: "Save adjustment" })).toBeDisabled();
});
