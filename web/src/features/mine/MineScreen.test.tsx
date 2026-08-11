import { asBusinessDate } from "@fleetsettle/shared";
import type { DriverViewResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { MineScreen } from "./MineScreen.js";

const today = asBusinessDate("2026-08-11");

const populatedView: DriverViewResponse = {
  owedToUsMinor: "200000",
  owedByUsMinor: "900000",
  days: [
    {
      businessDate: "2026-08-10",
      state: "did_not_run",
      earnedMinor: "0",
      receivedMinor: "0",
      lostReason: "breakdown",
    },
  ],
  trips: [
    {
      id: "t1",
      vehicleId: "v1",
      closingDate: "2026-08-09",
      agreedAmountMinor: "3000000",
      driverFeeMinor: "500000",
    },
  ],
  advances: [{ id: "a1", amountMinor: "100000", issuedOn: "2026-08-03", status: "open" }],
  offsets: [{ id: "o1", amountMinor: "50000", occurredOn: "2026-08-05" }],
  deposit: { id: "dep1", heldMinor: "250000" },
};

test("B5: linked driver sees his own balances and recent activity without a driver id", async () => {
  const get = vi.fn().mockResolvedValue(populatedView);
  renderWithProviders(<MineScreen today={today} />, { get });

  expect(await screen.findByText("He owes you")).toBeInTheDocument();
  expect(screen.getByText("Rs 2,000")).toBeInTheDocument();
  expect(screen.getByText("You owe him")).toBeInTheDocument();
  expect(screen.getByText("Rs 9,000")).toBeInTheDocument();
  expect(screen.getByText("Recent days · 1")).toBeInTheDocument();
  expect(screen.getByText("Did not run")).toBeInTheDocument();
  expect(screen.getByText(/Breakdown/)).toBeInTheDocument();
  expect(screen.getByText("Trips and fees · 1")).toBeInTheDocument();
  expect(screen.getByText("Advances · 1")).toBeInTheDocument();
  expect(screen.getByText("Offsets · 1")).toBeInTheDocument();
  expect(screen.getByText("Held deposit")).toBeInTheDocument();

  expect(get).toHaveBeenCalledWith("/api/driver-view?from=2026-07-12&to=2026-08-11");
  expect(get.mock.calls[0]?.[0]).not.toContain("driverId");
});

test("B5: Mine is read-only and has no write buttons on a successful read", async () => {
  renderWithProviders(<MineScreen today={today} />, {
    get: vi.fn().mockResolvedValue(populatedView),
  });

  await screen.findByText("Recent days · 1");

  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("GAP-101: failed driver-view read shows a scoped failure", async () => {
  const get = vi
    .fn()
    .mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-driver-view"));
  renderWithProviders(<MineScreen today={today} />, { get });

  expect(
    await screen.findByText("Something went wrong loading your driver view."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});
