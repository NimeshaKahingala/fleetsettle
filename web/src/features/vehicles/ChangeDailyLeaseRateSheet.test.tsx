import { asBusinessDate } from "@fleetsettle/shared";
import type { DailyLeaseRateResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ChangeDailyLeaseRateSheet } from "./ChangeDailyLeaseRateSheet.js";

const today = asBusinessDate("2026-08-15");

const changed: DailyLeaseRateResponse = {
  dailyLeaseId: "dl1",
  dailyLeaseAmountMinor: "600000",
  effectiveFrom: "2026-08-15",
};

async function fillAmount(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Enter new daily lease amount" }));
  await user.click(screen.getByRole("button", { name: "6" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
}

/** F-4.3/UC-32/GAP-2: amount and an editable effective date, defaulting to today. */
test("submits the new amount with today's date by default, on this lease's own id", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(changed);
  renderWithProviders(
    <ChangeDailyLeaseRateSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      dailyLeaseId="dl1"
      today={today}
    />,
    { post },
  );

  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Change the daily lease amount" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/daily-lease/dl1/rate", {
      dailyLeaseAmountMinor: "6",
      effectiveFrom: today,
    }),
  );
});

test("the submit button stays disabled until an amount is entered", () => {
  renderWithProviders(
    <ChangeDailyLeaseRateSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      dailyLeaseId="dl1"
      today={today}
    />,
    {},
  );

  expect(screen.getByRole("button", { name: "Change the daily lease amount" })).toBeDisabled();
});
