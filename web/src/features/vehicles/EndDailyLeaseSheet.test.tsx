import { asBusinessDate } from "@fleetsettle/shared";
import type { DailyLeaseResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { EndDailyLeaseSheet } from "./EndDailyLeaseSheet.js";

const today = asBusinessDate("2026-08-15");

const ended: DailyLeaseResponse = {
  id: "dl1",
  vehicleId: "v1",
  driverId: "d1",
  patternType: "every_day",
  patternWeekdays: null,
  effectiveFrom: "2026-06-01",
  effectiveTo: "2026-08-15",
  dailyLeaseAmountMinor: "450000",
};

/** F-4.8/UC-101/GAP-25: only field is the end date, defaulting to today. */
test("F-4.8: submits with today's date by default, on this lease's own id", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(ended);
  const onEnded = vi.fn();
  const onOpenChange = vi.fn();
  renderWithProviders(
    <EndDailyLeaseSheet
      open
      onOpenChange={onOpenChange}
      vehicleId="v1"
      dailyLeaseId="dl1"
      today={today}
      onEnded={onEnded}
    />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "End daily lease" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/daily-lease/dl1/end", { effectiveTo: today }),
  );
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(onEnded).toHaveBeenCalledOnce();
});

/** INV-37: this form carries no driver-balance check of its own to mirror — a failure here is only ever the transport/validation kind. */
test("shows the server's error message rather than a silent failure", async () => {
  const user = userEvent.setup();
  const post = vi
    .fn()
    .mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "This daily lease has already ended", "req-1"),
    );
  renderWithProviders(
    <EndDailyLeaseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      dailyLeaseId="dl1"
      today={today}
    />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "End daily lease" }));

  expect(await screen.findByText("This daily lease has already ended")).toBeInTheDocument();
});
