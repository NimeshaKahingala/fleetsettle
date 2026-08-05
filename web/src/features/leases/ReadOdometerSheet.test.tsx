import { asBusinessDate } from "@fleetsettle/shared";
import type { MileageAssessmentResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ReadOdometerSheet } from "./ReadOdometerSheet.js";

const today = asBusinessDate("2026-07-15");

test("records a reading and shows the resulting excess before closing", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "ma1",
    leaseId: "l1",
    drivenKm: 3200,
    combinedAllowanceKm: 3000,
    excessKm: 200,
    excessAmountMinor: "1000000",
    isEstimated: false,
    status: "final",
    splits: [],
    obligationId: "o1",
    autoWaived: false,
  } satisfies MileageAssessmentResponse);
  const onOpenChange = vi.fn();
  renderWithProviders(
    <ReadOdometerSheet open onOpenChange={onOpenChange} leaseId="l1" today={today} />,
    { post },
  );

  await user.type(screen.getByLabelText("Reading (km)"), "45200");
  await user.click(screen.getByRole("button", { name: "In person" }));
  await user.click(screen.getByRole("button", { name: "Save reading" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/mileage-assessment", {
      leaseId: "l1",
      readingKm: 45200,
      readOn: today,
      source: "in_person",
    }),
  );

  expect(await screen.findByText("3200 km")).toBeInTheDocument();
  expect(screen.getByText("3000 km")).toBeInTheDocument();
  expect(screen.getByText(/^200 km/)).toHaveTextContent("200 km · Rs 10,000");
  // Sheet stays open showing the result — Done is a separate, explicit close.
  expect(onOpenChange).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("an estimated, auto-waived assessment says so", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "ma2",
    leaseId: "l1",
    drivenKm: 3010,
    combinedAllowanceKm: 3000,
    excessKm: 10,
    excessAmountMinor: "5000",
    isEstimated: true,
    status: "provisional",
    splits: [],
    obligationId: "o2",
    autoWaived: true,
  } satisfies MileageAssessmentResponse);
  renderWithProviders(
    <ReadOdometerSheet open onOpenChange={() => {}} leaseId="l1" today={today} />,
    {
      post,
    },
  );

  await user.type(screen.getByLabelText("Reading (km)"), "45010");
  await user.click(screen.getByRole("button", { name: "Photo" }));
  await user.click(screen.getByRole("button", { name: "Save reading" }));

  expect(await screen.findByText(/apportioned by days/)).toBeInTheDocument();
  expect(screen.getByText(/auto-waive threshold/)).toBeInTheDocument();
});

test("Save reading stays disabled until both a reading and a source are given", () => {
  renderWithProviders(
    <ReadOdometerSheet open onOpenChange={() => {}} leaseId="l1" today={today} />,
    {
      post: vi.fn(),
    },
  );

  expect(screen.getByRole("button", { name: "Save reading" })).toBeDisabled();
});
