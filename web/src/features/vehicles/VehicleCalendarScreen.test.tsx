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

function baseGet(days: VehicleCalendarDay[]) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/vehicle/v1") return Promise.resolve(vehicle);
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
