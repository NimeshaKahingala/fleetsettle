import type {
  AccountingPeriodListRow,
  MeResponse,
  OverheadsResponse,
  PartnerSummaryResponse,
  VehicleMonthResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import {
  ReviewThisMonthScreen,
  computeDeltaPercent,
  computeMyShare,
} from "./ReviewThisMonthScreen.js";

function minor(v: bigint) {
  return v as never;
}

describe("computeMyShare", () => {
  test("sums this user's own share across every vehicle", () => {
    const vehicles: VehicleMonthResponse["vehicles"] = [
      {
        vehicleId: "v1",
        registration: "NB-1234",
        earnedMinor: "0",
        costsMinor: "0",
        profitMinor: "13400000",
        ownerShares: [
          { userId: "u1", displayName: "Me", shareBp: 6000, profitShareMinor: "8040000" },
          { userId: "u2", displayName: "Partner", shareBp: 4000, profitShareMinor: "5360000" },
        ],
      },
      {
        vehicleId: "v2",
        registration: "CAR-5678",
        earnedMinor: "0",
        costsMinor: "0",
        profitMinor: "1000000",
        ownerShares: [
          { userId: "u1", displayName: "Me", shareBp: 10000, profitShareMinor: "1000000" },
        ],
      },
    ];

    expect(computeMyShare(vehicles, "u1")).toBe(9040000n);
  });

  test("a vehicle this user holds no share of contributes nothing, not an error", () => {
    const vehicles: VehicleMonthResponse["vehicles"] = [
      {
        vehicleId: "v1",
        registration: "NB-1234",
        earnedMinor: "0",
        costsMinor: "0",
        profitMinor: "1000000",
        ownerShares: [
          { userId: "u2", displayName: "Partner", shareBp: 10000, profitShareMinor: "1000000" },
        ],
      },
    ];
    expect(computeMyShare(vehicles, "u1")).toBe(0n);
  });
});

describe("computeDeltaPercent", () => {
  test("a real increase", () => {
    expect(computeDeltaPercent(minor(11000n), minor(10000n))).toBeCloseTo(10, 5);
  });

  test("a real decrease", () => {
    expect(computeDeltaPercent(minor(9000n), minor(10000n))).toBeCloseTo(-10, 5);
  });

  test("no predecessor period — omitted, not zero", () => {
    expect(computeDeltaPercent(minor(10000n), undefined)).toBeNull();
  });

  test("a predecessor share of exactly zero — omitted, not a division by zero", () => {
    expect(computeDeltaPercent(minor(10000n), minor(0n))).toBeNull();
  });
});

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

const currentReport: VehicleMonthResponse = {
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

const overheads: OverheadsResponse = { totalMinor: "200000" };
const partner: PartnerSummaryResponse = {
  userId: "u1",
  displayName: "Me",
  period: { id: "p-jul", periodStart: "2026-07-01", periodEnd: "2026-07-31" },
  putIn: { contributionsMinor: "0", outOfPocketMinor: "0" },
  takenOut: { payoutsMinor: "0", settlementsMinor: "0" },
  earned: { profitShareMinor: "13400000", managementFeeMinor: "0" },
  holdingMinor: "0",
  balanceMinor: "13400000",
};

test("first period: no predecessor, so the delta line is omitted entirely — and the golden vehicle-month figure reproduces", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/accounting-period") return Promise.resolve(periods);
    if (path.startsWith("/api/reports/vehicle-month")) return Promise.resolve(currentReport);
    if (path.startsWith("/api/reports/overheads")) return Promise.resolve(overheads);
    if (path === "/api/home/paperwork-warnings") return Promise.resolve([]);
    if (path === "/api/partner/u1") return Promise.resolve(partner);
    return Promise.resolve([]);
  });

  renderWithProviders(
    <ReviewThisMonthScreen onSelectVehicle={() => {}} onSelectMyMoney={() => {}} />,
    { get },
    undefined,
    me,
  );

  expect(await screen.findByText("NB-1234")).toBeInTheDocument();
  expect(screen.getAllByText("Rs 134,000")).not.toHaveLength(0);
  expect(screen.queryByText(/vs last month/)).not.toBeInTheDocument();
  expect(await screen.findByText("Overheads (no vehicle)")).toBeInTheDocument();
  expect(screen.getByText("Rs 2,000")).toBeInTheDocument();
  expect(await screen.findByText("What I'm owed")).toBeInTheDocument();
});
