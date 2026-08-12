import type { AccountingPeriodListRow, VehicleMonthResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ReviewVehicleDetailScreen } from "./ReviewVehicleDetailScreen.js";

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
      ownerShares: [],
    },
  ],
};

test("renders this vehicle's figures for the given period", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period") return Promise.resolve(periods);
    return Promise.resolve(report);
  });
  renderWithProviders(
    <ReviewVehicleDetailScreen vehicleId="v1" periodId="p-jul" onBack={() => {}} />,
    { get },
  );

  expect(await screen.findByText("NB-1234")).toBeInTheDocument();
  expect(screen.getByText("Rs 134,000")).toBeInTheDocument();
});

test("GAP-101: a failed report read shows a failure notice, never the false 'No figures for this vehicle in this period.' the old isPending-only guard produced", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period") return Promise.resolve(periods);
    return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  });
  renderWithProviders(
    <ReviewVehicleDetailScreen vehicleId="v1" periodId="p-jul" onBack={() => {}} />,
    { get },
  );

  expect(
    await screen.findByText("Something went wrong loading this vehicle's figures."),
  ).toBeInTheDocument();
  expect(screen.queryByText("No figures for this vehicle in this period.")).not.toBeInTheDocument();
});

test("a genuinely empty result (read succeeded, no figures) still shows the honest empty message", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period") return Promise.resolve(periods);
    return Promise.resolve({ ...report, vehicles: [] } satisfies VehicleMonthResponse);
  });
  renderWithProviders(
    <ReviewVehicleDetailScreen vehicleId="v1" periodId="p-jul" onBack={() => {}} />,
    { get },
  );

  expect(
    await screen.findByText("No figures for this vehicle in this period."),
  ).toBeInTheDocument();
});
