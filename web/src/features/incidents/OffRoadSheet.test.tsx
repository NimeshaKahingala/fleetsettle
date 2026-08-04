import { asBusinessDate } from "@fleetsettle/shared";
import type { RecordOffRoadResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { OffRoadSheet } from "./OffRoadSheet.js";

const today = asBusinessDate("2026-07-08");

const incidentAfter: RecordOffRoadResponse["incident"] = {
  id: "inc1",
  vehicleId: "v1",
  leaseId: "l1",
  status: "open",
  occurredOn: "2026-07-08",
  description: null,
  offRoadFrom: "2026-07-08",
  offRoadTo: "2026-07-08",
  rentTreatment: "continue",
  closedAt: null,
};

test("'continue' is the default — no lease is touched", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ incident: incidentAfter });
  const onRecorded = vi.fn();
  renderWithProviders(
    <OffRoadSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      today={today}
      onRecorded={onRecorded}
    />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/incident/inc1/off-road", {
      offRoadFrom: today,
      offRoadTo: today,
      rentTreatment: "continue",
    }),
  );
  expect(onRecorded).toHaveBeenCalledOnce();
});

test("choosing 'Extend the rental' passes rentTreatment: extend", async () => {
  const user = userEvent.setup();
  const post = vi
    .fn()
    .mockResolvedValue({ incident: { ...incidentAfter, rentTreatment: "extend" } });
  renderWithProviders(
    <OffRoadSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      today={today}
      onRecorded={() => {}}
    />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Extend the rental" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/incident/inc1/off-road",
      expect.objectContaining({ rentTreatment: "extend" }),
    ),
  );
});

test("a validation error (no lease to apply the treatment to) surfaces inline", async () => {
  const user = userEvent.setup();
  const post = vi
    .fn()
    .mockRejectedValue(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "This incident has no lease to apply a rent treatment to",
        "req-1",
      ),
    );
  renderWithProviders(
    <OffRoadSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      today={today}
      onRecorded={() => {}}
    />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Credit the days" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(
    await screen.findByText("This incident has no lease to apply a rent treatment to"),
  ).toBeInTheDocument();
});
