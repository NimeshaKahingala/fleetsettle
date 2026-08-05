import { asBusinessDate } from "@fleetsettle/shared";
import type { InsuranceClaimResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { InsuranceClaimSheet } from "./InsuranceClaimSheet.js";

const today = asBusinessDate("2026-07-10");

const submitted: InsuranceClaimResponse = {
  id: "claim1",
  incidentId: "inc1",
  claimedAmountMinor: "7500000",
  excessBorneMinor: "1500000",
  status: "submitted",
  receivedAmountMinor: null,
  receivedOn: null,
};

function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`index ${index.toString()} out of bounds`);
  return item;
}

async function enterAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  await user.click(nth(screen.getAllByRole("button", { name: "Rs 0" }), 0));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("Submit claim stays disabled until an amount claimed is entered", () => {
  renderWithProviders(
    <InsuranceClaimSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      today={today}
      onSubmitted={() => {}}
    />,
    { post: vi.fn() },
  );

  expect(screen.getByRole("button", { name: "Submit claim" })).toBeDisabled();
});

test("amount claimed alone is enough — excess is optional and omitted when untouched", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(submitted);
  const onSubmitted = vi.fn();
  renderWithProviders(
    <InsuranceClaimSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      today={today}
      onSubmitted={onSubmitted}
    />,
    { post },
  );

  await enterAmount(user, "7500000");
  await user.click(screen.getByRole("button", { name: "Submit claim" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/incident/inc1/insurance-claim", {
      claimedAmountMinor: "7500000",
      claimedOn: today,
    }),
  );
  expect(onSubmitted).toHaveBeenCalledOnce();
});

test("a given excess reaches the request alongside the claimed amount", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(submitted);
  renderWithProviders(
    <InsuranceClaimSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      today={today}
      onSubmitted={() => {}}
    />,
    { post },
  );

  // Claimed amount first — the only "Rs 0" trigger left afterward is excess's.
  await enterAmount(user, "7500000");
  await user.click(screen.getByRole("button", { name: "Rs 0" }));
  for (const digit of "1500000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(screen.getByRole("button", { name: "Submit claim" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/incident/inc1/insurance-claim", {
      claimedAmountMinor: "7500000",
      excessBorneMinor: "1500000",
      claimedOn: today,
    }),
  );
});
