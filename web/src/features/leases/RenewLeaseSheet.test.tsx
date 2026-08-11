import { parse } from "@fleetsettle/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { RenewLeaseSheet } from "./RenewLeaseSheet.js";

test("pre-fills the current rent, and saves with rent alone — mileage terms stay level 2 and optional", async () => {
  const user = userEvent.setup();
  const patch = vi.fn().mockResolvedValue({
    id: "l1",
    vehicleId: "v1",
    customerId: "c1",
    status: "active",
    startDate: "2026-01-12",
    endDate: null,
    billingDay: 12,
    rentAmountMinor: "70000",
    mileageDailyLimitKm: null,
    mileageExcessRateMinor: null,
    reminderDaysBefore: 3,
  });
  const onOpenChange = vi.fn();
  renderWithProviders(
    <RenewLeaseSheet
      open
      onOpenChange={onOpenChange}
      leaseId="l1"
      currentRentMinor={parse("70000")}
    />,
    { patch },
  );

  expect(screen.getByRole("button", { name: "Rs 700" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save new terms" }));

  await vi.waitFor(() =>
    expect(patch).toHaveBeenCalledWith("/api/lease/l1/renew", { rentAmountMinor: "70000" }),
  );
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test("a new amount and mileage terms both reach the request", async () => {
  const user = userEvent.setup();
  const patch = vi.fn().mockResolvedValue({});
  renderWithProviders(
    <RenewLeaseSheet open onOpenChange={vi.fn()} leaseId="l1" currentRentMinor={parse("70000")} />,
    { patch },
  );

  await user.click(screen.getByRole("button", { name: "Rs 700" }));
  // AmountPad builds on top of its pre-filled value — clear "70000" first.
  for (let i = 0; i < 5; i++) {
    await user.click(screen.getByRole("button", { name: "Backspace" }));
  }
  for (const digit of "80000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(screen.getByRole("button", { name: "More" }));
  await user.type(screen.getByLabelText("Daily km limit"), "150");
  await user.click(screen.getByRole("button", { name: "Enter excess fee per km" }));
  for (const digit of "5000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(screen.getByRole("button", { name: "Save new terms" }));

  await vi.waitFor(() =>
    expect(patch).toHaveBeenCalledWith("/api/lease/l1/renew", {
      rentAmountMinor: "80000",
      mileageDailyLimitKm: 150,
      mileageExcessRateMinor: "5000",
    }),
  );
});
