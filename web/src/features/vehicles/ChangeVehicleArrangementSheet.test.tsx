import { asBusinessDate } from "@fleetsettle/shared";
import type { VehicleArrangementResponse } from "@fleetsettle/shared/schemas";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ChangeVehicleArrangementSheet } from "./ChangeVehicleArrangementSheet.js";

const today = asBusinessDate("2026-08-20");

const changed: VehicleArrangementResponse = {
  id: "11111111-1111-1111-1111-111111111111",
  vehicleId: "v1",
  arrangement: "C",
  effectiveFrom: "2026-08-21",
  effectiveTo: null,
};

/** F-1.2/UC-94/GAP-54: arrangement change is a new row from an effective business date, not an overwrite. */
test("submits the selected arrangement and effective date for this vehicle", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(changed);
  renderWithProviders(
    <ChangeVehicleArrangementSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      currentArrangement="B"
      today={today}
    />,
    { post },
  );

  await user.selectOptions(screen.getByLabelText("New arrangement"), "C");
  fireEvent.change(screen.getByLabelText(/Effective from/), {
    target: { value: "2026-08-21" },
  });
  await user.click(screen.getByRole("button", { name: "Change arrangement" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/vehicle/v1/arrangement", {
      arrangement: "C",
      effectiveFrom: asBusinessDate("2026-08-21"),
    }),
  );
});

test("does not allow saving the current arrangement again", () => {
  renderWithProviders(
    <ChangeVehicleArrangementSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      currentArrangement="B"
      today={today}
    />,
    {},
  );

  expect(screen.getByRole("option", { name: "Daily lease" })).toBeDisabled();
});
