import { asBusinessDate } from "@fleetsettle/shared";
import type {
  VehicleCalendarDay,
  VehicleResponse,
  VehicleUnavailabilityListResponse,
} from "@fleetsettle/shared/schemas";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { VehicleCalendarScreen } from "./VehicleCalendarScreen.js";

const today = asBusinessDate("2026-07-15");

const vehicle: VehicleResponse = {
  id: "v1",
  registration: "CAB-1234",
  vehicleType: "Bus",
  lifecycle: "active",
  serviceIntervalKm: null,
  arrangement: "B",
};

const leaseVehicle: VehicleResponse = { ...vehicle, arrangement: "A" };

function baseGet(
  days: VehicleCalendarDay[],
  overrideVehicle: VehicleResponse = vehicle,
  unavailability: VehicleUnavailabilityListResponse = [],
) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/vehicle/v1") return Promise.resolve(overrideVehicle);
    if (path.startsWith("/api/vehicle/v1/calendar")) return Promise.resolve(days);
    if (path.startsWith("/api/vehicle/v1/unavailability")) return Promise.resolve(unavailability);
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

test("GAP-101/INV-1: a failed calendar read shows a failure notice, never every day rendered as free", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle/v1") return Promise.resolve(vehicle);
    if (path.startsWith("/api/vehicle/v1/calendar")) {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    return Promise.resolve([]);
  });
  renderWithProviders(<VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(
    await screen.findByText("Something went wrong loading this month's calendar."),
  ).toBeInTheDocument();
  expect(screen.queryByTestId(`day-${today}`)).not.toBeInTheDocument();
});

/**
 * GAP-127: `byDate` used to be built from `days ?? []` with no gate on the
 * fetch's own pending window, so every date read as `undefined` — free,
 * startable, bookable — for the whole flight, exactly the shape GAP-101 was
 * built to close on this screen's own error branch, missed on the pending
 * one. The deferred `get` below keeps the query pending long enough to
 * observe it, the same technique GAP-125's own regression test uses.
 */
test("GAP-127: shows a loading notice while the calendar is in flight, never every day rendered as free", async () => {
  let resolveDays: ((value: VehicleCalendarDay[]) => void) | undefined;
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle/v1") return Promise.resolve(vehicle);
    if (path.startsWith("/api/vehicle/v1/calendar")) {
      return new Promise<VehicleCalendarDay[]>((resolve) => {
        resolveDays = resolve;
      });
    }
    return Promise.resolve([]);
  });
  renderWithProviders(
    <VehicleCalendarScreen
      vehicleId="v1"
      today={today}
      onBack={() => {}}
      onSelectFreeDayForTrip={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Loading…")).toBeInTheDocument();
  expect(screen.queryByTestId(`day-${today}`)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: `Book a trip from ${today}` }),
  ).not.toBeInTheDocument();

  resolveDays?.([]);
  expect(await screen.findByTestId(`day-${today}`)).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
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
  expect(
    await within(await screen.findByTestId("day-2026-07-05")).findByText("L"),
  ).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-10")).getByText("✓")).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-11")).getByText("!")).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-12")).getByText("B")).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-20")).getByText("T")).toBeInTheDocument();
  expect(within(screen.getByTestId("day-2026-07-21")).getByText("T?")).toBeInTheDocument();

  // Not scheduled — a real, un-styled day, never a guessed state.
  const unscheduled = screen.getByTestId("day-2026-07-15");
  expect(unscheduled.className).not.toContain("wash");
});

test("GAP-46: every occupied cell names its own state to a screen reader, the same wording the legend uses", async () => {
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
  // The month label renders synchronously; the grid's real content waits on
  // the calendar query. Warm up on the first cell's glyph, the same way the
  // neighbouring "seven day-states" test does, before asserting synchronously.
  await within(await screen.findByTestId("day-2026-07-05")).findByText("L");
  expect(screen.getByTestId("day-2026-07-05")).toHaveAttribute(
    "aria-label",
    "2026-07-05 — On a lease",
  );
  expect(screen.getByTestId("day-2026-07-10")).toHaveAttribute(
    "aria-label",
    "2026-07-10 — Daily lease, ran",
  );
  expect(screen.getByTestId("day-2026-07-11")).toHaveAttribute(
    "aria-label",
    "2026-07-11 — Daily lease, lost",
  );
  expect(screen.getByTestId("day-2026-07-12")).toHaveAttribute(
    "aria-label",
    "2026-07-12 — Daily lease, not yet confirmed",
  );
  expect(screen.getByTestId("day-2026-07-20")).toHaveAttribute(
    "aria-label",
    "2026-07-20 — On a trip",
  );
  expect(screen.getByTestId("day-2026-07-21")).toHaveAttribute(
    "aria-label",
    "2026-07-21 — Hold (tentative)",
  );
});

test("daily-lease ran and not-yet-confirmed no longer share a colour (UI-LF-07)", async () => {
  const days: VehicleCalendarDay[] = [
    {
      businessDate: "2026-07-10",
      arrangement: "B",
      sourceType: "daily_lease",
      sourceId: "dl1",
      isHold: false,
      dayRecordState: "ran_paid_full",
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
      businessDate: "2026-07-11",
      arrangement: "B",
      sourceType: "daily_lease",
      sourceId: "dl1",
      isHold: false,
      dayRecordState: "did_not_run",
    },
  ];
  const get = baseGet(days);
  renderWithProviders(<VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />, {
    get,
  });

  await screen.findByText("July 2026");
  // Wait for the calendar query itself, not just the (synchronous) month
  // label, before reading classes off cells it hasn't painted yet.
  await within(await screen.findByTestId("day-2026-07-10")).findByText("✓");
  expect(screen.getByTestId("day-2026-07-10").className).toContain("bg-good/15");
  expect(screen.getByTestId("day-2026-07-12").className).toContain("bg-warning/15");
  expect(screen.getByTestId("day-2026-07-11").className).toContain("bg-critical/15");
});

test("the legend lists all six renderable states", async () => {
  const get = baseGet([]);
  renderWithProviders(<VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />, {
    get,
  });

  await screen.findByText("July 2026");
  expect(await screen.findByText("On a lease")).toBeInTheDocument();
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
  const cell = await within(await screen.findByTestId("day-2026-07-15")).findByText("L");
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
  expect((await screen.findByTestId("day-2026-07-15")).tagName).not.toBe("BUTTON");
});

test("GAP-26: a day inside a live outage renders its own glyph, and is never tappable — even on an arrangement-A vehicle's otherwise-free day", async () => {
  const unavailability: VehicleUnavailabilityListResponse = [
    {
      id: "u1",
      vehicleId: "v1",
      reason: "service",
      unavailableFrom: "2026-07-14",
      unavailableTo: "2026-07-16",
      note: null,
    },
  ];
  const get = baseGet([], leaseVehicle, unavailability);
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
  const cell = await screen.findByTestId("day-2026-07-15");
  expect(within(cell).getByText("R")).toBeInTheDocument();
  expect(cell.tagName).not.toBe("BUTTON");
  // A day outside the range, on the same otherwise-free vehicle, stays tappable.
  const freeDay = await screen.findByTestId("day-2026-07-20");
  expect(freeDay.tagName).toBe("BUTTON");
});

test("GAP-26: an open-ended outage (no unavailableTo yet) still covers a later date in the same month", async () => {
  const unavailability: VehicleUnavailabilityListResponse = [
    {
      id: "u1",
      vehicleId: "v1",
      reason: "sale_preparation",
      unavailableFrom: "2026-07-10",
      unavailableTo: null,
      note: null,
    },
  ];
  const get = baseGet([], vehicle, unavailability);
  renderWithProviders(<VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />, {
    get,
  });

  await screen.findByText("July 2026");
  expect(within(await screen.findByTestId("day-2026-07-25")).getByText("R")).toBeInTheDocument();
});

test("GAP-26: a failed outage read shows a failure notice, the same guard a failed calendar read already gets", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle/v1") return Promise.resolve(vehicle);
    if (path.startsWith("/api/vehicle/v1/calendar")) return Promise.resolve([]);
    if (path.startsWith("/api/vehicle/v1/unavailability")) {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    return Promise.resolve([]);
  });
  renderWithProviders(<VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(
    await screen.findByText("Something went wrong loading this month's calendar."),
  ).toBeInTheDocument();
  expect(screen.queryByTestId(`day-${today}`)).not.toBeInTheDocument();
});

const manager = { userId: "u1", businessId: "b1", role: "manager" as const };

test("GAP-147: a manager can mark a vehicle unavailable", async () => {
  const user = userEvent.setup();
  const get = baseGet([]);
  const post = vi.fn().mockResolvedValue({
    id: "u2",
    vehicleId: "v1",
    reason: "service",
    unavailableFrom: today,
    unavailableTo: null,
    note: null,
  });
  renderWithProviders(
    <VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />,
    { get, post },
    undefined,
    manager,
  );

  await screen.findByText("July 2026");
  await user.click(screen.getByRole("button", { name: "Mark unavailable" }));
  await user.click(screen.getByRole("button", { name: "Service" }));
  const submitButtons = screen.getAllByRole("button", { name: "Mark unavailable" });
  const submit = submitButtons.at(-1);
  if (submit === undefined) throw new Error("expected submit button");
  await user.click(submit);

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/vehicle/v1/unavailability",
      expect.objectContaining({ reason: "service", unavailableFrom: today }),
    ),
  );
  // ongoing (checked by default) omits unavailableTo entirely
  const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
  expect(body).not.toHaveProperty("unavailableTo");
});

test("GAP-147: a manager can void an unavailable period, and it drops off the list once voided_at IS NULL excludes it", async () => {
  const user = userEvent.setup();
  const unavailability: VehicleUnavailabilityListResponse = [
    {
      id: "u1",
      vehicleId: "v1",
      reason: "sale_preparation",
      unavailableFrom: "2026-07-10",
      unavailableTo: "2026-07-20",
      note: null,
    },
  ];
  const get = baseGet([], vehicle, unavailability);
  const post = vi.fn().mockResolvedValue({ voidedAt: "2026-07-15T00:00:00.000Z" });
  renderWithProviders(
    <VehicleCalendarScreen vehicleId="v1" today={today} onBack={() => {}} />,
    { get, post },
    undefined,
    manager,
  );

  expect(await screen.findByText("Unavailable periods · 1")).toBeInTheDocument();
  expect(screen.getByText("Sale prep")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Void period" }));
  await user.type(screen.getByLabelText("Reason"), "Vehicle was actually available");
  const submitButtons = screen.getAllByRole("button", { name: "Void period" });
  const submit = submitButtons.at(-1);
  if (submit === undefined) throw new Error("expected submit button");
  await user.click(submit);

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/vehicle/v1/unavailability/u1/void", {
      reason: "Vehicle was actually available",
    }),
  );
});
