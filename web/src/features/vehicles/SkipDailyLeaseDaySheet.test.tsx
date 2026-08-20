import { asBusinessDate } from "@fleetsettle/shared";
import type { LeaseDayExceptionResponse } from "@fleetsettle/shared/schemas";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { SkipDailyLeaseDaySheet } from "./SkipDailyLeaseDaySheet.js";

const today = asBusinessDate("2026-08-20");

const skipped: LeaseDayExceptionResponse = {
  id: "11111111-1111-1111-1111-111111111111",
  dailyLeaseId: "dl1",
  exceptionDate: "2026-08-21",
  reason: "Driver wedding",
};

/** F-1.7/GAP-20: a skipped date is stored as an exception, not as a generated day card. */
test("submits the skipped date and optional reason", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(skipped);
  renderWithProviders(
    <SkipDailyLeaseDaySheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      dailyLeaseId="dl1"
      today={today}
    />,
    { post },
  );

  fireEvent.change(screen.getByLabelText(/Skipped date/), {
    target: { value: "2026-08-21" },
  });
  await user.type(screen.getByLabelText("Reason (optional)"), "Driver wedding");
  await user.click(screen.getByRole("button", { name: "Skip daily lease day" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/daily-lease/dl1/exception", {
      exceptionDate: asBusinessDate("2026-08-21"),
      reason: "Driver wedding",
    }),
  );
});

test("omits a blank reason", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...skipped, reason: null });
  renderWithProviders(
    <SkipDailyLeaseDaySheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      dailyLeaseId="dl1"
      today={today}
    />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Skip daily lease day" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/daily-lease/dl1/exception", {
      exceptionDate: today,
    }),
  );
});
