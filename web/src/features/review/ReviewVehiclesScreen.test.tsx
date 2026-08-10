import type {
  AccountingPeriodListRow,
  MeResponse,
  VehicleMonthResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ReviewVehiclesScreen } from "./ReviewVehiclesScreen.js";

const me: MeResponse = { userId: "u1", businessId: "b1", role: "owner" };

const periods: AccountingPeriodListRow[] = [
  {
    id: "p-jul",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    status: "open",
    closedAt: null,
  },
];

const report: VehicleMonthResponse = {
  period: { id: "p-jul", periodStart: "2026-07-01", periodEnd: "2026-07-31" },
  vehicles: [
    {
      vehicleId: "v1",
      registration: "NB-1234",
      earnedMinor: "18000000",
      costsMinor: "4600000",
      profitMinor: "13400000",
      ownerShares: [
        { userId: "u1", displayName: "Me", shareBp: 10000, profitShareMinor: "13400000" },
      ],
    },
  ],
};

test("lists every vehicle for the current open period", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period") return Promise.resolve(periods);
    return Promise.resolve(report);
  });
  renderWithProviders(<ReviewVehiclesScreen onSelectVehicle={() => {}} />, { get }, undefined, me);

  expect(await screen.findByText("NB-1234")).toBeInTheDocument();
});

test("GAP-101: a failed period-list read shows a failure notice — without it the vehicle-month read can never resolve", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<ReviewVehiclesScreen onSelectVehicle={() => {}} />, { get }, undefined, me);

  expect(
    await screen.findByText("Something went wrong loading the accounting periods."),
  ).toBeInTheDocument();
});

test("GAP-101: a failed vehicle-month read (periods themselves fine) shows its own failure notice", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period") return Promise.resolve(periods);
    return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  });
  renderWithProviders(<ReviewVehiclesScreen onSelectVehicle={() => {}} />, { get }, undefined, me);

  expect(
    await screen.findByText("Something went wrong loading this month's vehicles."),
  ).toBeInTheDocument();
});
