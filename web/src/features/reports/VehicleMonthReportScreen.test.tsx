import type { AccountingPeriodListRow, VehicleMonthResponse } from "@fleetsettle/shared/schemas";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import {
  VehicleMonthReportScreen,
  VehicleRow,
  toChartData,
  toKpiTotals,
} from "./VehicleMonthReportScreen.js";

const bareVehicles: VehicleMonthResponse["vehicles"] = [
  {
    vehicleId: "v1",
    registration: "NB-1234",
    earnedMinor: "18000000",
    costsMinor: "4600000",
    profitMinor: "13400000",
    ownerShares: [],
  },
  {
    vehicleId: "v2",
    registration: "CAR-5678",
    earnedMinor: "500000",
    costsMinor: "800000",
    profitMinor: "-300000",
    ownerShares: [],
  },
];

describe("toKpiTotals", () => {
  test("sums earned/costs/profit across vehicles, including a negative one", () => {
    const totals = toKpiTotals(bareVehicles);
    expect(totals.earnedMinor).toBe(18500000n);
    expect(totals.costsMinor).toBe(5400000n);
    expect(totals.profitMinor).toBe(13100000n);
  });

  test("an empty vehicle list totals to zero, not undefined", () => {
    const totals = toKpiTotals([]);
    expect(totals.earnedMinor).toBe(0n);
    expect(totals.costsMinor).toBe(0n);
    expect(totals.profitMinor).toBe(0n);
  });
});

describe("VehicleRow — GAP-162: 'No activity' must track earned/costs, not profit", () => {
  test("equal earned and costs (real activity, zero profit) does not show 'No activity'", () => {
    render(
      <VehicleRow
        vehicle={{
          vehicleId: "v1",
          registration: "NB-1234",
          earnedMinor: "100000",
          costsMinor: "100000",
          profitMinor: "0",
          ownerShares: [],
        }}
      />,
    );
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  });

  test("both earned and costs genuinely zero shows 'No activity'", () => {
    render(
      <VehicleRow
        vehicle={{
          vehicleId: "v1",
          registration: "NB-1234",
          earnedMinor: "0",
          costsMinor: "0",
          profitMinor: "0",
          ownerShares: [],
        }}
      />,
    );
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });
});

describe("VehicleRow — GAP-188/F-8.1: a late fact is its own line, never silent", () => {
  test("a late fact renders its label, amount and 'Belongs to' badge when the row is expanded", async () => {
    const user = userEvent.setup();
    render(
      <VehicleRow
        vehicle={{
          vehicleId: "v1",
          registration: "NB-1234",
          earnedMinor: "105000",
          costsMinor: "0",
          profitMinor: "105000",
          ownerShares: [],
          lateFacts: [
            {
              id: "f1",
              label: "Rent",
              amountMinor: "5000",
              sign: "earned",
              belongsToPeriodStart: "2026-06-01",
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText("Belongs to June 2026")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /NB-1234/ }));

    expect(screen.getByText("Rent")).toBeInTheDocument();
    expect(screen.getByText("Rs 50")).toBeInTheDocument();
    expect(screen.getByText("Belongs to June 2026")).toBeInTheDocument();
  });

  test("no lateFacts at all (the year report's own row shape) renders nothing extra", async () => {
    const user = userEvent.setup();
    render(
      <VehicleRow
        vehicle={{
          vehicleId: "v1",
          registration: "NB-1234",
          earnedMinor: "100000",
          costsMinor: "0",
          profitMinor: "100000",
          ownerShares: [],
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /NB-1234/ }));
    expect(screen.queryByText(/Belongs to/)).not.toBeInTheDocument();
  });
});

describe("toChartData (vehicle-month)", () => {
  test("one bar per vehicle, labelled by registration, a loss renders as a real negative value", () => {
    const data = toChartData(bareVehicles);
    expect(data).toEqual([
      { id: "v1", label: "NB-1234", value: 13400000, formattedValue: "Rs 134,000" },
      { id: "v2", label: "CAR-5678", value: -300000, formattedValue: "Rs −3,000" },
    ]);
  });
});

const periods: AccountingPeriodListRow[] = [
  {
    id: "p-jul",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    status: "open",
    closedAt: null,
  },
  {
    id: "p-jun",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    status: "closed",
    closedAt: "2026-07-01",
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
        { userId: "u1", displayName: "Nimesha", shareBp: 6000, profitShareMinor: "8040000" },
        { userId: "u2", displayName: "Tanuja", shareBp: 4000, profitShareMinor: "5360000" },
      ],
    },
  ],
};

/** G-1's own golden figure (TRACKER.md's 134,000) — the per-vehicle card must reproduce it. */
test("the per-vehicle card reads the G-1 golden figure, and expanding it shows each owner's share", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period") return Promise.resolve(periods);
    return Promise.resolve(report);
  });
  renderWithProviders(<VehicleMonthReportScreen onPeriodChange={() => {}} onBack={() => {}} />, {
    get,
  });

  await user.click(await screen.findByRole("button", { name: "Table" }));
  expect(await screen.findByText("Rs 134,000")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /NB-1234/ }));
  expect(await screen.findByText("Nimesha")).toBeInTheDocument();
  expect(screen.getByText("60%")).toBeInTheDocument();
  expect(screen.getByText("Rs 80,400")).toBeInTheDocument();
});

test("defaults to the open period when none is given", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period") return Promise.resolve(periods);
    return Promise.resolve(report);
  });
  renderWithProviders(<VehicleMonthReportScreen onPeriodChange={() => {}} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("1 Jul 2026 – 31 Jul 2026")).toBeInTheDocument();
});

test("GAP-101: a failed period-list read shows a failure notice — without it resolvedPeriodId can never resolve", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<VehicleMonthReportScreen onPeriodChange={() => {}} onBack={() => {}} />, {
    get,
  });

  expect(
    await screen.findByText("Something went wrong loading the accounting periods."),
  ).toBeInTheDocument();
});

test("GAP-101: a failed vehicle-month read (period list itself fine) shows its own failure notice", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period") return Promise.resolve(periods);
    return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  });
  renderWithProviders(<VehicleMonthReportScreen onPeriodChange={() => {}} onBack={() => {}} />, {
    get,
  });

  expect(
    await screen.findByText("Something went wrong loading how this month went."),
  ).toBeInTheDocument();
});
