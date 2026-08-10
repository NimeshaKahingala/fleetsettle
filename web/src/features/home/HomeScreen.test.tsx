import { businessToday, addDays } from "@fleetsettle/shared";
import type {
  ActiveDailyLeaseRow,
  DepositReleaseRow,
  InProgressTripRow,
  PaperworkWarningRow,
  ReceivableRow,
  UnconfirmedDayRecordRow,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { HomeScreen } from "./HomeScreen.js";

const today = businessToday();

/**
 * Every path this screen never asks about resolves to empty, so a test only
 * has to say what it cares about. `ConfirmDayCard` (used by both item 3 and
 * item 4) additionally fetches `GET /api/daily-lease/{id}` for its own rate
 * lookup — every fixture in this file uses "500000" for that rate, so one
 * generic fallback covers all of them without a per-id map.
 */
function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path.startsWith("/api/day-record/")) {
      return Promise.reject(new ApiError(404, "NOT_FOUND", "not yet confirmed", "req-1"));
    }
    if (path.startsWith("/api/daily-lease/")) {
      return Promise.resolve({
        id: path.split("/").pop(),
        vehicleId: "v1",
        driverId: "d1",
        patternType: "every_day",
        patternWeekdays: null,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        dailyLeaseAmountMinor: "500000",
      });
    }
    return Promise.resolve([]);
  });
  return get;
}

test("nothing outstanding renders the empty state, not a blank screen", async () => {
  const get = baseGet();
  renderWithProviders(<HomeScreen onSelectVehicle={vi.fn()} onSelectTrip={vi.fn()} />, { get });

  expect(await screen.findByText("Nothing needs you today")).toBeInTheDocument();
});

test("GAP-101: one failed read shows its own failure notice and never renders the empty state, while the section that succeeded still renders", async () => {
  const receivables: ReceivableRow[] = [
    {
      partyType: "customer",
      partyId: "c1",
      partyName: "Perera Tours",
      outstandingMinor: "1500000",
      oldestDueOn: "2026-07-01",
    },
  ];
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/home/paperwork-warnings") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/reports/receivables") return Promise.resolve(receivables);
    if (path.startsWith("/api/day-record/")) {
      return Promise.reject(new ApiError(404, "NOT_FOUND", "not yet confirmed", "req-1"));
    }
    return Promise.resolve([]);
  });
  renderWithProviders(<HomeScreen onSelectVehicle={vi.fn()} onSelectTrip={vi.fn()} />, { get });

  expect(await screen.findByText("Rent due · 1")).toBeInTheDocument();
  expect(screen.getByText("Something went wrong loading paperwork warnings.")).toBeInTheDocument();
  expect(screen.queryByText("Nothing needs you today")).not.toBeInTheDocument();
});

test("GAP-101: every read failing shows a failure notice per section, never 'Nothing needs you today' — the false-empty state this item exists to close", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<HomeScreen onSelectVehicle={vi.fn()} onSelectTrip={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading paperwork warnings."),
  ).toBeInTheDocument();
  expect(screen.getByText("Something went wrong loading today's vehicles.")).toBeInTheDocument();
  expect(
    screen.getByText("Something went wrong loading earlier unconfirmed days."),
  ).toBeInTheDocument();
  expect(screen.getByText("Something went wrong loading rent due.")).toBeInTheDocument();
  expect(screen.getByText("Something went wrong loading deposits to release.")).toBeInTheDocument();
  expect(screen.getByText("Something went wrong loading trips in progress.")).toBeInTheDocument();
  expect(screen.queryByText("Nothing needs you today")).not.toBeInTheDocument();
});

test("a paperwork warning renders as an alert strip, styled by isExpired, with a vehicle action but not a driver one", async () => {
  const warnings: PaperworkWarningRow[] = [
    {
      subjectType: "vehicle",
      subjectId: "v1",
      subjectLabel: "CAB-1234",
      docType: "insurance",
      expiryDate: "2026-08-10",
      isExpired: false,
    },
    {
      subjectType: "driver",
      subjectId: "d1",
      subjectLabel: "Nimal",
      docType: "licence",
      expiryDate: "2026-07-20",
      isExpired: true,
    },
  ];
  const onSelectVehicle = vi.fn();
  const user = userEvent.setup();
  const get = baseGet({ "/api/home/paperwork-warnings": warnings });
  renderWithProviders(<HomeScreen onSelectVehicle={onSelectVehicle} onSelectTrip={vi.fn()} />, {
    get,
  });

  const vehicleAlert = await screen.findByText(/CAB-1234 — insurance expires 2026-08-10/);
  expect(vehicleAlert).toBeInTheDocument();
  expect(screen.getByText(/Nimal — licence expired 2026-07-20/)).toBeInTheDocument();

  const alerts = screen.getAllByRole("alert");
  expect(alerts).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: "View vehicle" }));
  expect(onSelectVehicle).toHaveBeenCalledWith("v1");
  // The driver-subject strip has no action — nowhere to navigate yet (Web-P4).
  expect(screen.getAllByRole("button", { name: "View vehicle" })).toHaveLength(1);
});

test("one vehicle running today renders its card directly, elevated, no summary row", async () => {
  const leases: ActiveDailyLeaseRow[] = [
    {
      id: "dl1",
      vehicleId: "v1",
      vehicleRegistration: "CAB-1111",
      vehicleType: "Bus",
      driverId: "d1",
      driverName: "Sunil",
      dailyLeaseAmountMinor: "500000",
    },
  ];
  const get = baseGet({ "/api/daily-lease": leases });
  renderWithProviders(<HomeScreen onSelectVehicle={vi.fn()} onSelectTrip={vi.fn()} />, { get });

  expect(await screen.findByText("Expected from Sunil")).toBeInTheDocument();
  expect(screen.queryByText(/vehicles running today/)).not.toBeInTheDocument();
});

test("four or more vehicles collapse to a summary row, which expands to the full stack on tap", async () => {
  const user = userEvent.setup();
  const leases: ActiveDailyLeaseRow[] = ["CAB-1", "CAB-2", "CAB-3", "CAB-4"].map((reg, index) => {
    const n = String(index);
    return {
      id: `dl${n}`,
      vehicleId: `v${n}`,
      vehicleRegistration: reg,
      vehicleType: "Bus",
      driverId: `d${n}`,
      driverName: `Driver ${n}`,
      dailyLeaseAmountMinor: "500000",
    };
  });
  const get = baseGet({ "/api/daily-lease": leases });
  renderWithProviders(<HomeScreen onSelectVehicle={vi.fn()} onSelectTrip={vi.fn()} />, { get });

  expect(await screen.findByText("4 vehicles running today")).toBeInTheDocument();
  expect(screen.getByText("Rs 20,000")).toBeInTheDocument();
  expect(screen.queryByText("Expected from Driver 0")).not.toBeInTheDocument();

  await user.click(screen.getByText("4 vehicles running today"));

  expect(await screen.findByText("Expected from Driver 0")).toBeInTheDocument();
  expect(screen.getByText("Expected from Driver 3")).toBeInTheDocument();
});

test("earlier unconfirmed days render inside a collapsible section, each its own confirmable card", async () => {
  const rows: UnconfirmedDayRecordRow[] = [
    {
      id: "dr1",
      dailyLeaseId: "dl1",
      vehicleId: "v1",
      vehicleRegistration: "CAB-1111",
      driverId: "d1",
      driverName: "Sunil",
      businessDate: addDays(today, -5),
      expectedMinor: "500000",
    },
  ];
  const get = baseGet({ "/api/day-record": rows });
  renderWithProviders(<HomeScreen onSelectVehicle={vi.fn()} onSelectTrip={vi.fn()} />, { get });

  expect(await screen.findByText("Earlier days · 1")).toBeInTheDocument();
  expect(await screen.findByText("Expected from Sunil")).toBeInTheDocument();
});

test("rent due shows only customer obligations, never a driver's arrears (that's the driver's own two-balance screen)", async () => {
  const receivables: ReceivableRow[] = [
    {
      partyType: "customer",
      partyId: "c1",
      partyName: "Perera Tours",
      outstandingMinor: "1500000",
      oldestDueOn: "2026-07-01",
    },
    {
      partyType: "driver",
      partyId: "d1",
      partyName: "Sunil",
      outstandingMinor: "200000",
      oldestDueOn: "2026-07-01",
    },
  ];
  const get = baseGet({ "/api/reports/receivables": receivables });
  renderWithProviders(<HomeScreen onSelectVehicle={vi.fn()} onSelectTrip={vi.fn()} />, { get });

  expect(await screen.findByText("Rent due · 1")).toBeInTheDocument();
  expect(screen.getByText("Perera Tours")).toBeInTheDocument();
  expect(screen.queryByText("Sunil")).not.toBeInTheDocument();
});

test("deposits to release and trips in progress each render in their own section, and a trip is tappable", async () => {
  const user = userEvent.setup();
  const onSelectTrip = vi.fn();
  const deposits: DepositReleaseRow[] = [
    {
      depositId: "dep1",
      partyType: "customer",
      partyId: "c1",
      partyName: "Perera Tours",
      holdReleaseDate: "2026-07-01",
      heldMinor: "5000000",
    },
  ];
  const trips: InProgressTripRow[] = [
    {
      id: "t1",
      vehicleId: "v1",
      vehicleRegistration: "CAB-9999",
      customerId: "c1",
      customerName: "Perera Tours",
      driverId: null,
      driverName: null,
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      destination: "Kandy",
    },
  ];
  const get = baseGet({
    "/api/home/deposit-releases": deposits,
    "/api/trip": trips,
  });
  renderWithProviders(<HomeScreen onSelectVehicle={vi.fn()} onSelectTrip={onSelectTrip} />, {
    get,
  });

  expect(await screen.findByText("Deposits to release · 1")).toBeInTheDocument();
  expect(screen.getByText("Trips in progress · 1")).toBeInTheDocument();
  expect(screen.getByText("CAB-9999")).toBeInTheDocument();
  expect(screen.getByText(/Kandy/)).toBeInTheDocument();

  await user.click(screen.getByText("CAB-9999"));
  expect(onSelectTrip).toHaveBeenCalledWith("t1");
});
