import { asBusinessDate } from "@fleetsettle/shared";
import type { LostDaysResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import {
  LostDaysReportScreen,
  toDriverTotals,
  toMonthChartData,
  toReasonChartData,
  toWeekdayChartData,
} from "./LostDaysReportScreen.js";

const today = asBusinessDate("2026-07-15");

describe("toDriverTotals", () => {
  test("sums per-weekday rows into one total per driver", () => {
    const rows: LostDaysResponse["byWeekday"] = [
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

describe("toMonthChartData (GAP-71)", () => {
  test("sums across drivers per month and sorts chronologically, not by count", () => {
    const rows: LostDaysResponse["byMonth"] = [
      {
        driverId: "d2",
        driverName: null,
        month: "2026-08",
        lost: 5,
        ran: 1,
        leaseEligible: 6,
        lostValueMinor: "250000",
      },
      {
        driverId: "d1",
        driverName: "Sunil",
        month: "2026-07",
        lost: 1,
        ran: 3,
        leaseEligible: 4,
        lostValueMinor: "50000",
      },
      {
        driverId: "d2",
        driverName: null,
        month: "2026-07",
        lost: 2,
        ran: 2,
        leaseEligible: 4,
        lostValueMinor: "100000",
      },
    ];
    expect(toMonthChartData(rows)).toEqual([
      { id: "2026-07", label: "Jul 2026", value: 3, formattedValue: "3" },
      { id: "2026-08", label: "Aug 2026", value: 5, formattedValue: "5" },
    ]);
  });
});

describe("toWeekdayChartData (GAP-71)", () => {
  test("all seven weekdays render, Sunday first, zeros included", () => {
    const rows: LostDaysResponse["byWeekday"] = [
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
    const data = toWeekdayChartData(rows);
    expect(data).toHaveLength(7);
    expect(data[0]).toMatchObject({ label: "Sun", value: 0 });
    expect(data[5]).toMatchObject({ label: "Fri", value: 2 });
    expect(data[6]).toMatchObject({ label: "Sat", value: 0 });
  });
});

describe("toReasonChartData (GAP-71)", () => {
  test("sums across drivers per reason, labelled and ordered like ReasonPicker", () => {
    const rows: LostDaysResponse["byReason"] = [
      {
        driverId: "d1",
        driverName: "Sunil",
        reason: "no_passengers",
        lost: 2,
        lostValueMinor: "100000",
      },
      { driverId: "d2", driverName: null, reason: "breakdown", lost: 1, lostValueMinor: "50000" },
      {
        driverId: "d1",
        driverName: "Sunil",
        reason: "no_passengers",
        lost: 1,
        lostValueMinor: "50000",
      },
    ];
    expect(toReasonChartData(rows)).toEqual([
      { id: "breakdown", label: "Breakdown", value: 1, formattedValue: "1" },
      { id: "no_passengers", label: "No passengers", value: 3, formattedValue: "3" },
    ]);
  });

  test("a reason with no lost days in the window is omitted, not shown at zero", () => {
    expect(toReasonChartData([])).toEqual([]);
  });
});

test("sums per-weekday rows into one figure per driver, and shows the ran+lost denominator", async () => {
  const user = userEvent.setup();
  const response: LostDaysResponse = {
    byWeekday: [
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
    ],
    byMonth: [
      {
        driverId: "d1",
        driverName: "Sunil",
        month: "2026-07",
        lost: 3,
        ran: 5,
        leaseEligible: 8,
        lostValueMinor: "150000",
      },
    ],
    byReason: [
      {
        driverId: "d1",
        driverName: "Sunil",
        reason: "no_passengers",
        lost: 3,
        lostValueMinor: "150000",
      },
    ],
  };
  const get = vi.fn().mockResolvedValue(response);
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

  // The primary chart view renders first — GAP-71's month/weekday/reason charts.
  expect(await screen.findByText("By weekday")).toBeInTheDocument();
  expect(screen.getByText("By reason")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "View as table" }));
  expect(screen.getByText("3 / 8")).toBeInTheDocument();
  expect(screen.getByText("Rs 1,500")).toBeInTheDocument();
});

test("no daily-lease days in the window reads as its own message, not 'no days lost'", async () => {
  const empty: LostDaysResponse = { byWeekday: [], byMonth: [], byReason: [] };
  const get = vi.fn().mockResolvedValue(empty);
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

test("GAP-101: a failed read shows a failure notice, never a false 'No daily-lease days in this window.'", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
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

  expect(await screen.findByText("Something went wrong loading lost days.")).toBeInTheDocument();
  expect(screen.queryByText("No daily-lease days in this window.")).not.toBeInTheDocument();
});
