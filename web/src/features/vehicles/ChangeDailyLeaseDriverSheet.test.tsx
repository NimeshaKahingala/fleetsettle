import { asBusinessDate } from "@fleetsettle/shared";
import type { DailyLeaseResponse, DriverResponse } from "@fleetsettle/shared/schemas";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ChangeDailyLeaseDriverSheet } from "./ChangeDailyLeaseDriverSheet.js";

const today = asBusinessDate("2026-08-20");

const drivers: DriverResponse[] = [
  {
    id: "d1",
    name: "Current Driver",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  },
  {
    id: "d2",
    name: "New Driver",
    mobile: "0712345678",
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  },
];

const changed: DailyLeaseResponse = {
  id: "dl2",
  vehicleId: "v1",
  driverId: "d2",
  patternType: "every_day",
  patternWeekdays: null,
  effectiveFrom: "2026-08-21",
  effectiveTo: null,
  dailyLeaseAmountMinor: "450000",
};

/** F-4.7/UC-36/GAP-62: the replacement daily lease names only the new driver and effective date. */
test("submits the selected replacement driver and effective date", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(drivers);
  const post = vi.fn().mockResolvedValue(changed);
  renderWithProviders(
    <ChangeDailyLeaseDriverSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      dailyLeaseId="dl1"
      currentDriverId="d1"
      today={today}
    />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Choose driver" }));
  expect(screen.queryByRole("button", { name: "Current Driver" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /New Driver/ }));
  fireEvent.change(screen.getByLabelText(/Effective from/), {
    target: { value: "2026-08-21" },
  });
  await user.click(screen.getByRole("button", { name: "Change driver" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/daily-lease/dl1/change-driver", {
      driverId: "d2",
      effectiveFrom: asBusinessDate("2026-08-21"),
    }),
  );
});

test("keeps submit disabled until a replacement driver is chosen", async () => {
  const get = vi.fn().mockResolvedValue(drivers);
  renderWithProviders(
    <ChangeDailyLeaseDriverSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      dailyLeaseId="dl1"
      currentDriverId="d1"
      today={today}
    />,
    { get },
  );

  expect(await screen.findByRole("button", { name: "Change driver" })).toBeDisabled();
});
