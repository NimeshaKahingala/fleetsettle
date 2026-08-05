import { asBusinessDate } from "@fleetsettle/shared";
import type { ClosedTripResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CloseTripSheet } from "./CloseTripSheet.js";

const today = asBusinessDate("2026-07-15");

const closed: Partial<ClosedTripResponse> = { status: "closed" };

test("closes with just the date — reading the odometer is skippable", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(closed);
  const onClosed = vi.fn();
  renderWithProviders(
    <CloseTripSheet open onOpenChange={() => {}} tripId="t1" today={today} onClosed={onClosed} />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Close trip" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/trip/t1/close", { closingDate: today }),
  );
  expect(onClosed).toHaveBeenCalledOnce();
});

test("reading the closing odometer now requires both a reading and a source", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(closed);
  renderWithProviders(
    <CloseTripSheet open onOpenChange={() => {}} tripId="t1" today={today} onClosed={() => {}} />,
    { post },
  );

  await user.click(screen.getByText("Read the closing odometer now"));
  await user.type(screen.getByLabelText("Closing odometer (km)"), "45200");
  await user.click(screen.getByRole("button", { name: "In person" }));
  await user.click(screen.getByRole("button", { name: "Close trip" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/trip/t1/close", {
      closingDate: today,
      closingOdometerKm: 45200,
      closingOdometerSource: "in_person",
    }),
  );
});

test("INV-17 — an unreconciled advance blocks with a Dialog, not inline text", async () => {
  const user = userEvent.setup();
  const post = vi
    .fn()
    .mockRejectedValue(
      new ApiError(
        409,
        "TRIP_ADVANCE_UNSETTLED",
        "An advance against this trip must be settled (F-6.3) before it can be closed",
        "req-1",
      ),
    );
  renderWithProviders(
    <CloseTripSheet open onOpenChange={() => {}} tripId="t1" today={today} onClosed={() => {}} />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Close trip" }));

  expect(await screen.findByText("An advance is still open")).toBeInTheDocument();
  expect(
    screen.getByText(
      "An advance against this trip must be settled (F-6.3) before it can be closed",
    ),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByText("An advance is still open")).not.toBeInTheDocument();
});

test("a non-INV-17 error surfaces as plain inline text, not a Dialog", async () => {
  const user = userEvent.setup();
  const post = vi
    .fn()
    .mockRejectedValue(new ApiError(400, "VALIDATION_ERROR", "closingDate is required", "req-2"));
  renderWithProviders(
    <CloseTripSheet open onOpenChange={() => {}} tripId="t1" today={today} onClosed={() => {}} />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Close trip" }));

  expect(await screen.findByText("closingDate is required")).toBeInTheDocument();
  expect(screen.queryByText("An advance is still open")).not.toBeInTheDocument();
});
