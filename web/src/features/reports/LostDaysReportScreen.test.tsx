import { asBusinessDate, type Minor } from "@fleetsettle/shared";
import type { LostDaysResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { LostDaysReportScreen, toChartData, toDriverTotals } from "./LostDaysReportScreen.js";

const today = asBusinessDate("2026-07-15");

function minor(v: bigint): Minor {
  return v as Minor;
}

describe("toDriverTotals", () => {
  test("sums per-weekday rows into one total per driver", () => {
    const rows: LostDaysResponse = [
      {
        driverId: "d1",
        driverName: "Sunil",
        weekday: 1,
        lost: 1,
        ran: 3,
        leaseEligible: 4,
        lostValueMinor: "50000",
      },
      {
        driverId: "d1",
        driverName: "Sunil",
        weekday: 5,
        lost: 2,
        ran: 2,
        leaseEligible: 4,
        lostValueMinor: "100000",
      },
      {
        driverId: "d2",
        driverName: null,
        weekday: 1,
        lost: 0,
        ran: 4,
        leaseEligible: 4,
        lostValueMinor: "0",
      },
    ];

    const totals = toDriverTotals(rows);
    expect(totals).toHaveLength(2);

    const sunil = totals.find((t) => t.driverId === "d1");
    expect(sunil).toMatchObject({ lost: 3, ran: 5, leaseEligible: 8 });
    expect(sunil?.lostValueMinor).toBe(150000n);

    const unnamed = totals.find((t) => t.driverId === "d2");
    expect(unnamed).toMatchObject({ driverName: null, lost: 0, leaseEligible: 4 });
  });

  test("an empty response totals to an empty list, not a fabricated zero row", () => {
    expect(toDriverTotals([])).toEqual([]);
  });
});

describe("toChartData (lost days)", () => {
  test("falls back to 'Unnamed driver' and uses the raw day count as the axis value", () => {
    const data = toChartData([
      {
        driverId: "d1",
        driverName: "Sunil",
        lost: 3,
        ran: 5,
        leaseEligible: 8,
        lostValueMinor: minor(150000n),
      },
      {
        driverId: "d2",
        driverName: null,
        lost: 0,
        ran: 4,
        leaseEligible: 4,
        lostValueMinor: minor(0n),
      },
    ]);
    expect(data).toEqual([
      { id: "d1", label: "Sunil", value: 3, formattedValue: "3" },
      { id: "d2", label: "Unnamed driver", value: 0, formattedValue: "0" },
    ]);
  });
});

test("sums per-weekday rows into one figure per driver, and shows the ran+lost denominator", async () => {
  const user = userEvent.setup();
  const rows: LostDaysResponse = [
    {
      driverId: "d1",
      driverName: "Sunil",
      weekday: 1,
      lost: 1,
      ran: 3,
      leaseEligible: 4,
      lostValueMinor: "50000",
    },
    {
      driverId: "d1",
      driverName: "Sunil",
      weekday: 5,
      lost: 2,
      ran: 2,
      leaseEligible: 4,
      lostValueMinor: "100000",
    },
  ];
  const get = vi.fn().mockResolvedValue(rows);
  renderWithProviders(
    <LostDaysReportScreen
      from={asBusinessDate("2026-07-01")}
      to={today}
      today={today}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  await user.click(await screen.findByRole("button", { name: "View as table" }));
  expect(screen.getByText("3 / 8")).toBeInTheDocument();
  expect(screen.getByText("Rs 1,500")).toBeInTheDocument();
});

test("no daily-lease days in the window reads as its own message, not 'no days lost'", async () => {
  const get = vi.fn().mockResolvedValue([] satisfies LostDaysResponse);
  renderWithProviders(
    <LostDaysReportScreen
      from={asBusinessDate("2026-07-01")}
      to={today}
      today={today}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("No daily-lease days in this window.")).toBeInTheDocument();
});
