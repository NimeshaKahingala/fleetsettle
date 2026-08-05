import type { CancelledTripResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CancelTripSheet } from "./CancelTripSheet.js";

const cancelled: Partial<CancelledTripResponse> = { status: "cancelled" };

test("cancels with no reason and no disposition — neither is required up front", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(cancelled);
  const onCancelled = vi.fn();
  renderWithProviders(
    <CancelTripSheet open onOpenChange={() => {}} tripId="t1" onCancelled={onCancelled} />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Cancel trip" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/trip/t1/cancel", {}));
  expect(onCancelled).toHaveBeenCalledOnce();
});

test("a reason reaches the request when given", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(cancelled);
  renderWithProviders(
    <CancelTripSheet open onOpenChange={() => {}} tripId="t1" onCancelled={() => {}} />,
    { post },
  );

  await user.type(screen.getByLabelText("Reason (optional)"), "Customer changed plans");
  await user.click(screen.getByRole("button", { name: "Cancel trip" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/trip/t1/cancel", {
      cancelReason: "Customer changed plans",
    }),
  );
});

test("an unsettled advance reveals the disposition chooser inline, then resubmits with it", async () => {
  const user = userEvent.setup();
  const post = vi
    .fn()
    .mockRejectedValueOnce(
      new ApiError(
        409,
        "TRIP_ADVANCE_UNSETTLED",
        "An advance against this trip needs a disposition (refunded or retained) before it can be cancelled",
        "req-1",
      ),
    )
    .mockResolvedValueOnce(cancelled);
  const onCancelled = vi.fn();
  renderWithProviders(
    <CancelTripSheet open onOpenChange={() => {}} tripId="t1" onCancelled={onCancelled} />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Cancel trip" }));

  expect(
    await screen.findByText(
      "An advance against this trip needs a disposition before it can cancel.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel trip" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Refund it" }));
  await user.click(screen.getByRole("button", { name: "Cancel trip" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenLastCalledWith("/api/trip/t1/cancel", {
      advanceDisposition: "refunded",
    }),
  );
  expect(onCancelled).toHaveBeenCalledOnce();
});

test("a non-advance error surfaces as plain inline text, no disposition chooser", async () => {
  const user = userEvent.setup();
  const post = vi
    .fn()
    .mockRejectedValue(new ApiError(400, "VALIDATION_ERROR", "trip is already closed", "req-2"));
  renderWithProviders(
    <CancelTripSheet open onOpenChange={() => {}} tripId="t1" onCancelled={() => {}} />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Cancel trip" }));

  expect(await screen.findByText("trip is already closed")).toBeInTheDocument();
  expect(screen.queryByText(/needs a disposition/)).not.toBeInTheDocument();
});
