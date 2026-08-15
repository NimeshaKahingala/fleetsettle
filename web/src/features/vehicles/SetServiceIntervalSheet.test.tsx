import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { SetServiceIntervalSheet } from "./SetServiceIntervalSheet.js";

const changed: VehicleResponse = {
  id: "v1",
  registration: "CAB-1234",
  vehicleType: "Bus",
  lifecycle: "active",
  serviceIntervalKm: 5000,
};

/** F-3.5/UC-13/GAP-68: "editable on the vehicle's own page, never required to save the vehicle" (U-2). */
test("sets a new interval", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(changed);
  renderWithProviders(
    <SetServiceIntervalSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      currentServiceIntervalKm={null}
    />,
    { post },
  );

  await user.type(screen.getByLabelText("Kilometres between services (optional)"), "5000");
  await user.click(screen.getByRole("button", { name: "Save service interval" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/vehicle/v1/service-interval", {
      serviceIntervalKm: 5000,
    }),
  );
});

/** Blank clears it — how the prompt turns back off, per the same flow's own decision text. */
test("leaving it blank clears a previously-set interval", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...changed, serviceIntervalKm: null });
  renderWithProviders(
    <SetServiceIntervalSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      currentServiceIntervalKm={5000}
    />,
    { post },
  );

  const field = screen.getByLabelText("Kilometres between services (optional)");
  expect(field).toHaveValue(5000);
  await user.clear(field);
  await user.click(screen.getByRole("button", { name: "Save service interval" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/vehicle/v1/service-interval", {
      serviceIntervalKm: null,
    }),
  );
});
