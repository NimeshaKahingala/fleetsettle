import type { RankedTripsResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { TripRankingReportScreen, toChartData } from "./TripRankingReportScreen.js";

const rows: RankedTripsResponse = [
  {
    id: "t1",
    vehicleId: "v1",
    registration: "NB-1234",
    agreedAmountMinor: "3000000",
    costsMinor: "1000000",
    driverFeeMinor: "500000",
    profitMinor: "1500000",
    distanceKm: 120,
    profitPerKm: 125,
  },
  {
    id: "t2",
    vehicleId: "v1",
    registration: "NB-1234",
    agreedAmountMinor: "500000",
    costsMinor: "900000",
    driverFeeMinor: "200000",
    profitMinor: "-600000",
    distanceKm: null,
    profitPerKm: null,
  },
];

describe("toChartData (trip ranking)", () => {
  test("keeps the server's own order and renders a loss-making trip's real negative profit", () => {
    expect(toChartData(rows)).toEqual([
      { id: "t1", label: "NB-1234", value: 1500000, formattedValue: "Rs 15,000" },
      { id: "t2", label: "NB-1234", value: -600000, formattedValue: "Rs −6,000" },
    ]);
  });
});

test("the table view shows NotAvailable for a trip with no closing odometer, not a fabricated ratio", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(rows);
  renderWithProviders(<TripRankingReportScreen onBack={() => {}} />, { get });

  await user.click(await screen.findByRole("tab", { name: "Table" }));

  expect(screen.getByText("125.00")).toBeInTheDocument();
  expect(screen.getByLabelText("Not available: no closing odometer")).toBeInTheDocument();
});

test("no closed trips yet reads as a real message, not an empty chart", async () => {
  const get = vi.fn().mockResolvedValue([] satisfies RankedTripsResponse);
  renderWithProviders(<TripRankingReportScreen onBack={() => {}} />, { get });

  expect(await screen.findByText("No closed trips yet.")).toBeInTheDocument();
});

test("GAP-101: a failed read shows a failure notice, never a false 'No closed trips yet.'", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<TripRankingReportScreen onBack={() => {}} />, { get });

  expect(
    await screen.findByText("Something went wrong loading which trips made money."),
  ).toBeInTheDocument();
  expect(screen.queryByText("No closed trips yet.")).not.toBeInTheDocument();
});
