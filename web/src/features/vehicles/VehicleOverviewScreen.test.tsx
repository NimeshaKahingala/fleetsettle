import type {
  ExpenseListRow,
  IncidentResponse,
  VehicleDailyLeaseHistoryRow,
  VehicleDocumentResponse,
  VehicleLeaseHistoryRow,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { VehicleOverviewScreen } from "./VehicleOverviewScreen.js";

const baseVehicle: VehicleResponse = {
  id: "v1",
  registration: "CAB-1234",
  vehicleType: "Bus",
  lifecycle: "active",
  arrangement: "B",
};

/** Every scoped read this screen fetches (`document`/`expense`/`lease`/`daily-lease`) defaults to empty, so a test only has to say what it cares about — the same convention `HomeScreen.test.tsx`'s own `baseGet` already established. */
function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/vehicle/v1") return Promise.resolve(baseVehicle);
    return Promise.resolve([]);
  });
  return get;
}

test("renders the vehicle's fields once loaded", async () => {
  const get = baseGet();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  expect(await screen.findByText("Bus")).toBeInTheDocument();
  expect(screen.getByText("Daily lease")).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/api/vehicle/v1");
});

test("GAP-101: a failed vehicle read shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  expect(await screen.findByText("Something went wrong loading this vehicle.")).toBeInTheDocument();
});

test("GAP-101: a failed paperwork read shows a failure notice rather than a silently missing Paperwork section", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle/v1/document") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/vehicle/v1") return Promise.resolve(baseVehicle);
    return Promise.resolve([]);
  });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  expect(await screen.findByText("Something went wrong loading paperwork.")).toBeInTheDocument();
});

test("the calendar action, via the Vehicle actions menu, calls onViewCalendar", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const onViewCalendar = vi.fn();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={onViewCalendar}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  await user.click(await screen.findByRole("button", { name: "Vehicle actions" }));
  await user.click(await screen.findByRole("button", { name: "View calendar" }));

  expect(onViewCalendar).toHaveBeenCalledOnce();
});

test("Report incident, via the Vehicle actions menu, opens the sheet and onSelectIncident lands on the new one", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({
    id: "inc1",
    vehicleId: "v1",
    leaseId: null,
    status: "open",
    occurredOn: "2026-08-04",
    description: null,
    offRoadFrom: null,
    offRoadTo: null,
    rentTreatment: null,
    closedAt: null,
    bottomLine: {
      totalRepairCostMinor: "0",
      totalRecoveredMinor: "0",
      pendingRecoveryMinor: "0",
      netCostMinor: "0",
    },
    recoveries: [],
    insuranceClaim: null,
  });
  const onSelectIncident = vi.fn();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={onSelectIncident}
      onStartDailyLease={() => undefined}
    />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Vehicle actions" }));
  await user.click(await screen.findByRole("button", { name: "Report incident" }));
  await user.click(await screen.findByRole("button", { name: "Report incident" }));

  expect(post).toHaveBeenCalledWith("/api/incident", expect.objectContaining({ vehicleId: "v1" }));
  await vi.waitFor(() => {
    expect(onSelectIncident).toHaveBeenCalledWith("inc1");
  });
});

test("Record expense, via the Vehicle actions menu, opens the sheet pre-filled to this vehicle (Web-P8b)", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({
    id: "e1",
    vehicleId: "v1",
    tripId: null,
    incidentId: null,
    category: "fuel",
    amountMinor: "5",
    spentOn: "2026-08-04",
    borneBy: "driver",
    borneByDriverId: "d1",
    borneByCustomerId: null,
    paidByUserId: "u1",
    litres: null,
    note: null,
  });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Vehicle actions" }));
  await user.click(await screen.findByRole("button", { name: "Record expense" }));

  // Pre-filled and locked to this vehicle — no vehicle picker rendered.
  expect(screen.queryByText("Choose vehicle")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Fuel" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() => {
    expect(post).toHaveBeenCalledWith(
      "/api/expense",
      expect.objectContaining({ vehicleId: "v1", category: "fuel" }),
    );
  });
});

test("no active arrangement renders NotAvailable, never a blank or a zero", async () => {
  const get = baseGet({
    "/api/vehicle/v1": { ...baseVehicle, arrangement: undefined },
  });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  expect(await screen.findByText("no active arrangement")).toBeInTheDocument();
});

test("nothing recorded in any scoped read renders no Paperwork, Costs, Incidents or History section", async () => {
  const get = baseGet();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  expect(await screen.findByText("Bus")).toBeInTheDocument();
  expect(screen.queryByText(/Paperwork/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Costs/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Incidents/)).not.toBeInTheDocument();
  expect(screen.queryByText(/History/)).not.toBeInTheDocument();
});

test("paperwork lists every document type with a date set", async () => {
  const documents: VehicleDocumentResponse[] = [
    { docType: "insurance", expiryDate: "2026-09-30" },
    { docType: "revenue_licence", expiryDate: "2027-01-15" },
  ];
  const get = baseGet({ "/api/vehicle/v1/document": documents });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  expect(await screen.findByText("Paperwork · 2")).toBeInTheDocument();
  expect(screen.getByText("Insurance")).toBeInTheDocument();
  expect(screen.getByText("Revenue licence")).toBeInTheDocument();
  expect(screen.getByText("Expires 30 Sept 2026")).toBeInTheDocument();
});

test("a voided expense stays in the costs list, struck through, with its reason (W-50)", async () => {
  const expenses: ExpenseListRow[] = [
    {
      id: "e1",
      vehicleId: "v1",
      tripId: null,
      incidentId: null,
      category: "fuel",
      amountMinor: "500000",
      spentOn: "2026-07-20",
      borneBy: "us",
      borneByDriverId: null,
      borneByCustomerId: null,
      paidByUserId: null,
      litres: null,
      note: null,
      voidedAt: null,
      voidedReason: null,
    },
    {
      id: "e2",
      vehicleId: "v1",
      tripId: null,
      incidentId: null,
      category: "repairs",
      amountMinor: "1200000",
      spentOn: "2026-07-10",
      borneBy: "us",
      borneByDriverId: null,
      borneByCustomerId: null,
      paidByUserId: null,
      litres: null,
      note: null,
      voidedAt: "2026-07-11T00:00:00Z",
      voidedReason: "wrong vehicle",
    },
  ];
  const get = baseGet({ "/api/vehicle/v1/expense": expenses });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  expect(await screen.findByText("Costs · 2")).toBeInTheDocument();
  expect(screen.getByText("Fuel")).toBeInTheDocument();
  const voidedCategory = screen.getByText("Repairs");
  expect(voidedCategory).toHaveClass("line-through");
  expect(screen.getByText("Voided")).toBeInTheDocument();
  expect(screen.getByText("wrong vehicle")).toBeInTheDocument();
});

test("history merges lease and daily-lease periods into one chronological list", async () => {
  const leases: VehicleLeaseHistoryRow[] = [
    {
      id: "l1",
      status: "closed",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      rentAmountMinor: "4500000",
      customerId: "c1",
      customerName: "Acme Traders",
    },
  ];
  const dailyLeases: VehicleDailyLeaseHistoryRow[] = [
    {
      id: "dl1",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "450000",
      driverId: "d1",
      driverName: "Sunil Perera",
    },
  ];
  const get = baseGet({
    "/api/vehicle/v1/lease": leases,
    "/api/vehicle/v1/daily-lease": dailyLeases,
  });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  expect(await screen.findByText("History · 2")).toBeInTheDocument();
  expect(screen.getByText("Daily lease · Rs 4,500/day")).toBeInTheDocument();
  expect(screen.getByText("Lease out · Rs 45,000/month")).toBeInTheDocument();
  expect(screen.getByText("Sunil Perera · 1 Jun 2026 – ongoing")).toBeInTheDocument();
  expect(screen.getByText("Acme Traders · 1 Jan 2025 – 31 Dec 2025")).toBeInTheDocument();
});

test("a lease entry in History is tappable onto its own hub; a daily-lease entry is not (Web-P6b)", async () => {
  const user = userEvent.setup();
  const leases: VehicleLeaseHistoryRow[] = [
    {
      id: "l1",
      status: "closed",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      rentAmountMinor: "4500000",
      customerId: "c1",
      customerName: "Acme Traders",
    },
  ];
  const dailyLeases: VehicleDailyLeaseHistoryRow[] = [
    {
      id: "dl1",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "450000",
      driverId: "d1",
      driverName: "Sunil Perera",
    },
  ];
  const get = baseGet({
    "/api/vehicle/v1/lease": leases,
    "/api/vehicle/v1/daily-lease": dailyLeases,
  });
  const onSelectLease = vi.fn();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={onSelectLease}
      onSelectIncident={() => {}}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  await user.click(await screen.findByText("Lease out · Rs 45,000/month"));
  expect(onSelectLease).toHaveBeenCalledOnce();
  expect(onSelectLease).toHaveBeenCalledWith("l1");

  // The daily-lease row has nothing to go to yet — a plain row, not a button.
  const dailyLeaseText = screen.getByText("Daily lease · Rs 4,500/day");
  expect(dailyLeaseText.closest("button")).toBeNull();
});

test("Incidents lists every one with its own status, and each row is tappable (Web-P8a)", async () => {
  const user = userEvent.setup();
  const incidents: IncidentResponse[] = [
    {
      id: "inc1",
      vehicleId: "v1",
      leaseId: null,
      status: "closed",
      occurredOn: "2026-06-01",
      description: "Rear bumper damage",
      offRoadFrom: "2026-06-01",
      offRoadTo: "2026-06-03",
      rentTreatment: "continue",
      closedAt: "2026-06-10",
    },
    {
      id: "inc2",
      vehicleId: "v1",
      leaseId: null,
      status: "open",
      occurredOn: "2026-07-08",
      description: null,
      offRoadFrom: null,
      offRoadTo: null,
      rentTreatment: null,
      closedAt: null,
    },
  ];
  const get = baseGet({ "/api/vehicle/v1/incident": incidents });
  const onSelectIncident = vi.fn();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={onSelectIncident}
      onStartDailyLease={() => undefined}
    />,
    { get },
  );

  expect(await screen.findByText("Incidents · 2")).toBeInTheDocument();
  expect(screen.getByText("Rear bumper damage")).toBeInTheDocument();
  expect(screen.getByText("Incident with no description")).toBeInTheDocument();
  expect(screen.getByText("Closed")).toBeInTheDocument();
  expect(screen.getByText("Open")).toBeInTheDocument();
  // UI-LF-04: status is a Badge with its own token, not plain muted text —
  // open and closed must not read identically.
  expect(screen.getByText("Closed").className).toContain("bg-good/15");
  expect(screen.getByText("Open").className).toContain("bg-warning/15");

  await user.click(screen.getByText("Rear bumper damage"));
  expect(onSelectIncident).toHaveBeenCalledWith("inc1");
});

/**
 * F-1.7's entry point (B10, GAP-51). Until this shipped there was no screen
 * anywhere that could start a daily lease, so arrangement B — the model the
 * bus in this project's own running example runs on — could not be started
 * by anyone. The gating is asserted both ways because "offered everywhere"
 * and "offered nowhere" are both wrong and only one of them is obvious.
 */
test.each([
  ["B", true],
  [undefined, true],
  ["A", false],
  ["C", false],
] as const)(
  "Start a daily lease is offered for arrangement %s: %s",
  async (arrangement, expected) => {
    const user = userEvent.setup();
    // `arrangement` is destructured off rather than overwritten: spreading
    // `{...baseVehicle}` and omitting the key leaves `baseVehicle`'s own "B"
    // in place, so the undefined case would silently re-test B.
    const { arrangement: _ignored, ...withoutArrangement } = baseVehicle;
    const get = baseGet({
      "/api/vehicle/v1":
        arrangement === undefined ? withoutArrangement : { ...baseVehicle, arrangement },
    });
    renderWithProviders(
      <VehicleOverviewScreen
        vehicleId="v1"
        onBack={() => {}}
        onViewCalendar={() => {}}
        onSelectLease={() => {}}
        onSelectIncident={() => {}}
        onStartDailyLease={() => undefined}
      />,
      { get },
    );

    await user.click(await screen.findByRole("button", { name: "Vehicle actions" }));

    const action = screen.queryByRole("button", { name: "Start a daily lease" });
    if (expected) expect(action).toBeInTheDocument();
    else expect(action).not.toBeInTheDocument();
  },
);

test("Start a daily lease, via the Vehicle actions menu, calls onStartDailyLease", async () => {
  const user = userEvent.setup();
  const onStartDailyLease = vi.fn();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
      onSelectIncident={() => {}}
      onStartDailyLease={onStartDailyLease}
    />,
    { get: baseGet() },
  );

  await user.click(await screen.findByRole("button", { name: "Vehicle actions" }));
  await user.click(await screen.findByRole("button", { name: "Start a daily lease" }));

  expect(onStartDailyLease).toHaveBeenCalledOnce();
});
