import { asBusinessDate } from "@fleetsettle/shared";
import type { VehicleCalendarDay, VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { VehicleCalendarScreen } from "./VehicleCalendarScreen.js";

const today = asBusinessDate("2026-07-15");

const vehicle: VehicleResponse = {
  id: "v1",
  registration: "CAB-1234",
  vehicleType: "Bus",
  lifecycle: "active",
  arrangement: "B",
};

const leaseVehicle: VehicleResponse = { ...vehicle, arrangement: "A" };

function baseGet(days: VehicleCalendarDay[], overrideVehicle: VehicleResponse = vehicle) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/vehicle/v1") return Promise.resolve(overrideVehicle);
    if (path.startsWith("/api/vehicle/v1/calendar")) return Promise.resolve(days);
    return Promise.resolve([]);
  });
  return get;
}

test("renders the current month's label and grid", async () => {
  const get = baseGet([]);
  renderWithProviders(<VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("July 2026")).toBeInTheDocument();
});

test("each of the seven day-states renders its own colour and glyph (UI §7.6)", async () => {
  const days: VehicleCalendarDay[] = [
    {
      businessDate: "2026-07-05",
      arrangement: "A",
      sourceType: "lease",
      sourceId: "l1",
      isHold: false,
      dayRecordState: null,
    },
    {
      businessDate: "2026-07-10",
      arrangement: "B",
      sourceType: "daily_lease",
      sourceId: "dl1",
      isHold: false,
      dayRecordState: "ran_paid_full",
    },
    {
      businessDate: "2026-07-11",
      arrangement: "B",
      sourceType: "daily_lease",
      sourceId: "dl1",
      isHold: false,
      dayRecordState: "did_not_run",
    },
    {
      businessDate: "2026-07-12",
      arrangement: "B",
      sourceType: "daily_lease",
      sourceId: "dl1",
      isHold: false,
      dayRecordState: "open",
    },
    {
      businessDate: "2026-07-20",
      arrangement: "C",
      sourceType: "trip",
      sourceId: "t1",
      isHold: false,
      dayRecordState: null,
    },
    {
      businessDate: "2026-07-21",
      arrangement: "C",
      sourceType: "trip",
      sourceId: "t2",
      isHold: true,
      dayRecordState: null,
    },
  ];
  const get = baseGet(days);
  renderWithProviders(<VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />, {
    get,
  });

  await screen.findByText("July 2026");
  expect(await within(screen.getByTestId("day-2026-07-05")).findByText("L")).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-10")).getByText("✓")).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-11")).getByText("!")).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-12")).getByText("B")).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-20")).getByText("T")).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-21")).getByText("T?")).toBeInTheDocument();

  // Not scheduled — a real, un-styled day, never a guessed state.
  const unscheduled = screen.getByTestId("day-2026-07-15");
  expect(unscheduled.className).not.toContain("wash");
});

test("the legend lists all six renderable states", async () => {
  const get = baseGet([]);
  renderWithProviders(<VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />, {
    get,
  });

  await screen.findByText("July 2026");
  expect(screen.getByText("On a lease")).toBeInTheDocument();
  expect(screen.getByText("Daily lease, ran")).toBeInTheDocument();
  expect(screen.getByText("Daily lease, not yet confirmed")).toBeInTheDocument();
  expect(screen.getByText("Daily lease, lost")).toBeInTheDocument();
  expect(screen.getByText("On a trip")).toBeInTheDocument();
  expect(screen.getByText("Hold (tentative)")).toBeInTheDocument();
});

test("next/previous month navigation changes the displayed month and re-fetches", async () => {
  const user = userEvent.setup();
  const get = baseGet([]);
  renderWithProviders(<VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />, {
    get,
  });

  await screen.findByText("July 2026");

  await user.click(screen.getByRole("button", { name: "Next month" }));
  expect(await screen.findByText("August 2026")).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/api/vehicle/v1/calendar?from=2026-08-01&to=2026-08-31");

  await user.click(screen.getByRole("button", { name: "Previous month" }));
  await user.click(screen.getByRole("button", { name: "Previous month" }));
  expect(await screen.findByText("June 2026")).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/api/vehicle/v1/calendar?from=2026-06-01&to=2026-06-30");
});

/** F-1.5's Accept, F-2.1 half (Web-P6c): "tapping a free day opens F-2.1 with that date filled in." Only wired for arrangement A — F-5.1 (the other half) is Web-P7. */
test("a free day is tappable on an arrangement-A vehicle and reports its own date", async () => {
  const user = userEvent.setup();
  const get = baseGet([], leaseVehicle);
  const onSelectFreeDay = vi.fn();
  renderWithProviders(
    <VehicleCalendarScreen
      vehicleId="v1"
      today={today}
      onBack={() => {}}
      onSelectFreeDay={onSelectFreeDay}
    />,
    { get },
  );

  await screen.findByText("July 2026");
  // "July 2026" resolves from local state, not the vehicle query — wait for
  // the cell's own button role, which only renders once arrangement A is known.
  await user.click(await screen.findByRole("button", { name: "Start a rental from 2026-07-15" }));

  expect(onSelectFreeDay).toHaveBeenCalledOnce();
  expect(onSelectFreeDay).toHaveBeenCalledWith("2026-07-15");
});

test("an already-occupied day is never tappable, even on an arrangement-A vehicle", async () => {
  const days: VehicleCalendarDay[] = [
    {
      businessDate: "2026-07-15",
      arrangement: "A",
      sourceType: "lease",
      sourceId: "l1",
      isHold: false,
      dayRecordState: null,
    },
  ];
  const get = baseGet(days, leaseVehicle);
  renderWithProviders(
    <VehicleCalendarScreen
      vehicleId="v1"
      today={today}
      onBack={() => {}}
      onSelectFreeDay={vi.fn()}
    />,
    { get },
  );

  await screen.findByText("July 2026");
  const cell = await within(screen.getByTestId("day-2026-07-15")).findByText("L");
  expect(cell.closest("button")).toBeNull();
});

test("a free day is not tappable on a non-arrangement-A vehicle (F-5.1 not built yet)", async () => {
  const get = baseGet([]); // default `vehicle` fixture — arrangement B
  renderWithProviders(
    <VehicleCalendarScreen
      vehicleId="v1"
      today={today}
      onBack={() => {}}
      onSelectFreeDay={vi.fn()}
    />,
    { get },
  );

  await screen.findByText("July 2026");
  expect(screen.getByTestId("day-2026-07-15").tagName).not.toBe("BUTTON");
});
