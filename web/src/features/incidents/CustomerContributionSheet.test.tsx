import { asBusinessDate } from "@fleetsettle/shared";
import type { IncidentRecoveryResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CustomerContributionSheet } from "./CustomerContributionSheet.js";

const today = asBusinessDate("2026-08-20");

const created: IncidentRecoveryResponse = {
  id: "rec1",
  incidentId: "inc1",
  source: "customer",
  agreedAmountMinor: "2000000",
  receivedAmountMinor: "0",
  replacesId: null,
  voidedAt: null,
  voidedReason: null,
};

async function enterAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  await user.click(screen.getByRole("button", { name: "Enter agreed amount" }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("Save stays disabled until an amount is entered", () => {
  renderWithProviders(
    <CustomerContributionSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      today={today}
      onRecorded={() => {}}
    />,
    { post: vi.fn() },
  );

  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("agreed amount, date and note reach the request", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const onRecorded = vi.fn();
  renderWithProviders(
    <CustomerContributionSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      today={today}
      onRecorded={onRecorded}
    />,
    { post },
  );

  await enterAmount(user, "20000");
  await user.type(screen.getByLabelText("Note"), "Agreed once the repair cost was known");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/incident/inc1/customer-contribution", {
      agreedAmountMinor: "20000",
      agreedOn: today,
      note: "Agreed once the repair cost was known",
    }),
  );
  expect(onRecorded).toHaveBeenCalledOnce();
});
