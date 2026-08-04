import { asBusinessDate } from "@fleetsettle/shared";
import type { IncidentDetailResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ReportIncidentSheet } from "./ReportIncidentSheet.js";

const today = asBusinessDate("2026-08-04");

const created: IncidentDetailResponse = {
  id: "inc1",
  vehicleId: "v1",
  leaseId: null,
  status: "open",
  occurredOn: "2026-08-04",
  description: null,
  offRoadFrom: null,
  offRoadTo: null,
  rentTreatment: null,
  closedAt: null,
  bottomLine: {
    totalRepairCostMinor: "0",
    totalRecoveredMinor: "0",
    pendingRecoveryMinor: "0",
    netCostMinor: "0",
  },
  recoveries: [],
  insuranceClaim: null,
};

test("saves with just the date — U-2's level-1 fields alone", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const onCreated = vi.fn();
  renderWithProviders(
    <ReportIncidentSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onCreated={onCreated}
    />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Report incident" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/incident", { vehicleId: "v1", occurredOn: today }),
  );
  expect(onCreated).toHaveBeenCalledWith("inc1");
});

test("a description, when given, reaches the request", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  renderWithProviders(
    <ReportIncidentSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onCreated={() => {}}
    />,
    { post },
  );

  await user.type(screen.getByLabelText("Description"), "Rear bumper damage");
  await user.click(screen.getByRole("button", { name: "Report incident" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/incident", {
      vehicleId: "v1",
      occurredOn: today,
      description: "Rear bumper damage",
    }),
  );
});
